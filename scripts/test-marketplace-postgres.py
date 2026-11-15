"""Apply tracked migrations and exercise concurrent RPCs on an explicitly disposable local PostgreSQL."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from pathlib import Path
import re
import subprocess
import time


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"
BASELINE_CUTOFF = "20261115120000"
FINANCIAL_ROLLOUT_CUTOFF = "20261115145000"
IDENTITY = """
select host(inet_server_addr()),inet_server_port(),current_database(),
       current_setting('cluster_name'),current_setting('data_directory'),
       current_setting('listen_addresses'),current_setting('server_version');
"""
BOOTSTRAP = """
select pg_advisory_xact_lock(6111511);
do $$ begin
  if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}'::jsonb);
create function auth.uid() returns uuid stable language sql
as $$ select nullif(current_setting('marketplace.test_user',true),'')::uuid $$;
grant usage on schema auth to anon,authenticated,service_role;
create publication supabase_realtime;
-- Catalog-level Storage stand-ins allow testing DDL/RLS, not the Storage HTTP service.
create schema storage;
create table storage.buckets(id text primary key,name text not null,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id));
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to authenticated;
create policy fixture_existing_broad_policy on storage.objects for all to authenticated using (true) with check (true);
create schema audit_migrations;
create table audit_migrations.applied(version text primary key, source_sha256 text not null);
"""
LEGACY = """
insert into auth.users(id,raw_user_meta_data)
values ('a118581e-f3bd-4bd4-8531-15cd6040a190', '{}'),
       ('9deb4d2d-a806-4528-a565-c8e2f1c35e13', '{}');
insert into public.rides(id,passenger_id,origin_address,origin_lat,origin_lng,destination_address,
destination_lat,destination_lng,distance_meters,duration_seconds,fare_cents,payment_method,service_type,service_details)
values ('49ad4390-eb77-413e-a807-c951d2e39a81','a118581e-f3bd-4bd4-8531-15cd6040a190',
  'Origem teste',-10.83,-38.53,'Destino teste',-10.84,-38.54,1600,500,500,'cash','passenger', '{}'),
 ('51acaf5a-64c2-4dc8-a002-a6942ccc0a3f','9deb4d2d-a806-4528-a565-c8e2f1c35e13',
  'Origem teste',-10.83,-38.53,'Destino teste',-10.84,-38.54,1600,500,700,'cash','delivery',
  '{"description":"Pacote sintético","recipientName":"Pessoa fictícia","recipientPhone":"+5575999991234"}');
"""


def require(condition, note):
    if not condition:
        raise RuntimeError(note)


def safe_error(result):
    return " ".join(re.findall(r"\b(?:[A-Z]{2,}_[A-Z_0-9]+|[0-9][0-9A-Z]{4})\b", result.stderr)[:5]) or f"exit {result.returncode}"


class Lab:
    def __init__(self, args):
        self.args = args
        self.environment = {key: value for key, value in os.environ.items() if not key.upper().startswith("PG")}
        self.environment.update(PGPASSWORD=args.password_file.read_text(encoding="ascii").strip(),
                                PGCONNECT_TIMEOUT="10", PGCLIENTENCODING="UTF8")
        require(bool(self.environment["PGPASSWORD"]), "Senha do laboratório não encontrada.")

    def command(self, database):
        return [str(self.args.psql), "-X", "-w", "-h", "127.0.0.1", "-p", str(self.args.port),
                "-U", "postgres", "-d", database, "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-f", "-"]

    def run(self, database, sql, ok=True, application="moto-audit"):
        env = {**self.environment, "PGAPPNAME": application}
        result = subprocess.run(self.command(database), input=sql, capture_output=True, text=True, encoding="utf-8", env=env, timeout=50)
        if ok:
            require(result.returncode == 0, f"SQL falhou em {database}: {safe_error(result)}")
            return result.stdout.strip()
        return result

    def guard(self, database):
        cols = self.run(database, IDENTITY).split("|")
        require(len(cols) == 7 and cols[:4] == ["127.0.0.1", str(self.args.port), database, self.args.cluster_name]
                and Path(cols[4]).resolve() == self.args.data_dir.resolve() and cols[5] == "127.0.0.1",
                "Identidade do laboratório não comprovada; nada será escrito.")
        return cols[6]

    def make_db(self, name):
        self.guard("postgres")
        require(not self.run("postgres", f"select datname from pg_database where datname='{name}';"), "Use um nome novo; nenhum banco será substituído.")
        self.run("postgres", f'create database "{name}";')
        self.guard(name)
        self.run(name, "begin;\n" + BOOTSTRAP + "\ncommit;")

    def apply(self, database, files):
        self.guard(database)
        applied = {}
        for row in self.run(database, "select version,source_sha256 from audit_migrations.applied;").splitlines():
            version, checksum = row.split("|")
            applied[version] = checksum
        total = 0
        for source in files:
            version = source.name[:14]
            data = source.read_bytes()
            checksum = hashlib.sha256(data).hexdigest()
            if version in applied:
                require(applied[version] == checksum, f"Migration registrada mudou: {source.name}")
                continue
            script = data.decode("utf-8-sig")
            result = self.run(database, f"begin;\n{script}\ninsert into audit_migrations.applied values ('{version}','{checksum}');\ncommit;", ok=False)
            # Migration setup contains only schema and synthetic rows. No raw SQL or
            # connection settings are emitted to the terminal.
            require(result.returncode == 0, f"Migration {source.name} não aplicada (transação encerrada): {safe_error(result)}")
            total += 1
        return total

    def race(self, database, label, left, right):
        barrier = 611151500
        names = [f"moto-{label}-a", f"moto-{label}-b"]
        owner = f"moto-barrier-{label}"
        coord = subprocess.Popen(self.command(database), stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 text=True, encoding="utf-8", env={**self.environment, "PGAPPNAME": owner})
        try:
            coord.stdin.write(f"select pg_advisory_lock({barrier});\n")
            coord.stdin.flush()
            for _ in range(30):
                if self.run(database, f"""select count(*) from pg_locks l join pg_stat_activity a using(pid)
                    where a.application_name='{owner}' and l.locktype='advisory' and l.granted;""") == "1":
                    break
                require(coord.poll() is None, f"{label}: sessão coordenadora terminou.")
                time.sleep(0.04)
            else:
                raise RuntimeError(f"{label}: barreira não adquirida.")
            def contender(body, name):
                return self.run(database, f"""
                    begin;
                    set local lock_timeout='8s';
                    set local statement_timeout='16s';
                    set local role service_role;
                    select pg_advisory_xact_lock_shared({barrier});
                    {body}
                    select pg_sleep(0.45);
                    commit;
                """, ok=False, application=name)
            with ThreadPoolExecutor(max_workers=2) as pool:
                jobs = [pool.submit(contender, body, name) for body, name in zip([left, right], names)]
                observed = False
                for _ in range(30):
                    waiting = self.run(database, f"""
                      select count(distinct pid) from pg_stat_activity
                      where application_name in ('{names[0]}','{names[1]}') and wait_event='advisory';
                    """)
                    if waiting == "2":
                        observed = True
                        break
                    time.sleep(0.04)
                coord.stdin.write(f"select pg_advisory_unlock({barrier});\n")
                coord.stdin.flush()
                results = [job.result() for job in jobs]
            require(observed, f"{label}: duas conexões independentes não chegaram à barreira.")
            for result in results:
                require(not re.search(r"\b(40P01|55P03|57014)\b", result.stderr), f"{label}: deadlock/timeout ({safe_error(result)}).")
            return results
        finally:
            if coord.poll() is None:
                coord.stdin.close()
                try:
                    coord.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    coord.terminate()
                    coord.wait(timeout=5)


def ident(name):
    return f"(select id from marketplace_test.identities where label='{name}')"


def order(name):
    return f"(select id from marketplace_test.orders where label='{name}')"


def rx(name):
    return f"(select id from public.rides where market_order_id={order(name)} and status not in ('finalizada','cancelada'))"


def as_service(body):
    return f"begin; set local role service_role; {body} commit;"


def checkout(case, buyer, attempt):
    return f"select marketplace_test.checkout('{case}','{buyer}','{attempt}');"


def verify_races(lab, db):
    def state(query, expected):
        value = lab.run(db, query)
        require(value == expected, f"Estado final inesperado: esperado {expected}; obtido {value[:100]}")

    def errors(results, expected=None):
        failures = [result for result in results if result.returncode != 0]
        require(len(failures) == int(expected is not None) and
                (not expected or expected in failures[0].stderr),
                f"Códigos de concorrência inesperados: {[safe_error(x) for x in failures]}")

    def stock(case):
        return f"select stock_quantity from public.market_products p join marketplace_test.cases c on c.product_id=p.id where c.label='{case}';"

    def number_orders(case):
        return f"select count(*) from public.market_orders o join marketplace_test.cases c on c.store_id=o.store_id where c.label='{case}';"

    def signal(results, trues):
        errors(results)
        require(sum("t" in result.stdout.splitlines() for result in results) == trues, "Número inesperado de RPCs vencedoras.")

    errors(lab.race(db, "stock", checkout("stock", "buyer_a", "a"), checkout("stock", "buyer_b", "b")), "MARKET_STOCK_UNAVAILABLE")
    state(stock("stock"), "0")
    state(number_orders("stock"), "1")
    print("B APROVADO — último item: apenas um pedido; estoque zero.", flush=True)

    same = checkout("idem", "buyer_a", "same")
    replays = lab.race(db, "idem", same, same)
    errors(replays)
    import json
    pairs = [json.loads(next(line for line in x.stdout.splitlines() if line.startswith("{"))) for x in replays]
    require(pairs[0]["orderId"] == pairs[1]["orderId"] and sorted(x["reused"] for x in pairs) == [False, True], "Idempotência: respostas divergentes.")
    state(number_orders("idem"), "1")
    state(stock("idem"), "9")
    print("C APROVADO — mesma chave/payload: uma ordem e uma reserva.", flush=True)

    receipt_amount = f"(select amount_cents from public.market_cash_payments where order_id={order('receipt')})"
    receive = f"select public.market_record_cash_action({ident('driver_a')},{order('receipt')},'receive',{receipt_amount},null,'Teste simultâneo');"
    errors(lab.race(db, "receipt", receive, receive))
    state(f"select count(*) from public.market_order_events where order_id={order('receipt')} and event_type='payment.cash_received';", "1")
    state(f"""select received_at is not null and received_amount_cents=amount_cents and settled_at is null
        from public.market_cash_payments where order_id={order('receipt')};""", "t")
    print("Recebimento APROVADO — duas chamadas, um evento e nenhum repasse automático.", flush=True)

    reported_settlement = f"(select store_due_cents from public.market_cash_payments where order_id={order('settlement')})"
    settle = f"select public.market_record_cash_action({ident('merchant')},{order('settlement')},'settle',{reported_settlement},'repasse-laboratorio-d','Teste simultâneo');"
    other_settle = settle.replace(ident("merchant"), ident("staff"))
    errors(lab.race(db, "settle", settle, other_settle))
    state(f"select count(*) from public.market_order_events where order_id={order('settlement')} and event_type='payment.store_settled';", "1")
    state(f"""select (received_at is not null) and (settled_at>=received_at)
        and received_amount_cents=amount_cents and settled_amount_cents=store_due_cents
        from public.market_cash_payments where order_id={order('settlement')};""", "t")
    print("D APROVADO — repasse concorrente idempotente: um evento.", flush=True)

    lab.run(db, """
      create function marketplace_test.fail_before_commit() returns trigger language plpgsql as $$
      begin
        if exists(select from public.market_orders o join marketplace_test.cases c on c.store_id=o.store_id
           where c.label='partial' and o.id=new.order_id) then raise exception 'FIXTURE_INJECTED_FAILURE'; end if;
        return new;
      end $$;
      create trigger fixture_injected before insert on public.market_cash_payments
      for each row execute function marketplace_test.fail_before_commit();
    """)
    failure = lab.run(db, as_service(checkout("partial", "buyer_a", "retry")), ok=False)
    require(failure.returncode != 0 and "FIXTURE_INJECTED_FAILURE" in failure.stderr, "Injeção E falhou.")
    state(stock("partial"), "10")
    state(number_orders("partial"), "0")
    lab.run(db, "drop trigger fixture_injected on public.market_cash_payments;")
    lab.run(db, as_service(checkout("partial", "buyer_a", "retry")))  # discard the successful response after commit
    require('"reused": true' in lab.run(db, as_service(checkout("partial", "buyer_a", "retry"))), "Replay E criou novo pedido.")
    state(stock("partial"), "9")
    state(number_orders("partial"), "1")
    print("E APROVADO — falha antes do commit reverte pedido/estoque; resposta descartada após commit é recuperável.", flush=True)

    lab.run(db, f"update public.drivers set online=false,available=false,on_shift=false where profile_id={ident('driver_b')};")
    dispatch = lambda name: f"select public.dispatch_market_order({order(name)});"
    dispatches = lab.race(db, "shared-driver", dispatch("delivery_a"), dispatch("delivery_b"))
    signal(dispatches, 1)
    a_rows = lab.run(db, f"select r.market_order_id={order('delivery_a')} from public.ride_requests rr join public.rides r on r.id=rr.ride_id where rr.status='pending' and rr.driver_id={ident('driver_a')};")
    require(a_rows in {"t", "f"}, "Esperava uma só reserva ativa do motorista.")
    winner, waiting = ("delivery_a", "delivery_b") if a_rows == "t" else ("delivery_b", "delivery_a")
    print("F APROVADO — dois pedidos, um driver elegível, uma reserva.", flush=True)

    signal(lab.race(db, "worker-replay", dispatch(winner), dispatch(winner)), 0)
    state(f"select count(*) from public.market_order_events where order_id={order(winner)} and event_type='delivery_offered';", "1")

    def take(name, driver):
        return f"select public.accept_market_delivery({rx(name)},{ident(driver)});"
    signal(lab.race(db, "accept", take(winner, "driver_a"), take(winner, "driver_b")), 1)
    state(f"select count(*) from public.market_order_events where order_id={order(winner)} and event_type='delivery_assigned';", "1")
    print("A APROVADO — concorrência entre ofertado e outro driver; só o ofertado aceitou.", flush=True)

    lab.run(db, f"""
      update public.drivers set online=true,available=true,on_shift=true where profile_id={ident('driver_b')};
      update public.driver_locations set updated_at=clock_timestamp() where driver_id={ident('driver_b')};
      update public.market_orders set dispatch_next_at=null where id={order(waiting)};
    """)
    signal(lab.race(db, "worker-due", dispatch(waiting), dispatch(waiting)), 1)
    state(f"select count(*) from public.market_order_events where order_id={order(waiting)} and event_type='delivery_offered';", "1")
    print("J APROVADO (despacho) — dois workers executaram tarefa devida e criaram uma oferta; replays não duplicaram.", flush=True)
    offline = f"select public.set_driver_online_status({ident('driver_b')},false);"
    conflict = lab.race(db, "accept-offline", take(waiting, "driver_b"), offline)
    winners = sum("t" in result.stdout.splitlines() for result in conflict)
    errors(conflict, "P0001" if winners else None)
    state(f"""select case when assigned_driver_id is null then not online else online end
       from public.market_orders o cross join public.drivers d where o.id={order(waiting)} and d.profile_id={ident('driver_b')};""", "t")
    print("G APROVADO (offline) — aceite e offline produzem estados compatíveis.", flush=True)

    def central_cancel(label):
        return f"select public.market_admin_delivery_action({ident('admin')},{order(label)},'cancel','Motivo sintético');"

    # Release the second driver without deleting the earlier order or its history.
    require(lab.run(db, as_service(central_cancel(waiting))) == "t", "Não foi possível liberar o motorista G.")
    lab.run(db, f"""
      update public.drivers set online=true,available=true,on_shift=true where profile_id={ident('driver_b')};
      update public.driver_locations set updated_at=clock_timestamp() where driver_id={ident('driver_b')};
      update public.market_stores set preferred_driver_id={ident('driver_b')}
         where id=(select store_id from marketplace_test.cases where label='partial');
    """)

    def prepare(label, order_id):
        lab.run(db, f"insert into marketplace_test.orders values ('{label}','{order_id}');")
        return lab.run(db, as_service(f"""
          select public.market_transition_order({ident('merchant')},{order(label)},'accept');
          select public.market_transition_order({ident('merchant')},{order(label)},'ready');
          {dispatch(label)}
        """)).splitlines()[-1] == "t"

    existing = json.loads(lab.run(db, as_service(checkout("partial", "buyer_a", "retry"))))["orderId"]
    require(prepare("g_cancel", existing), "Não foi possível preparar G/cancelamento.")
    errors(lab.race(db, "accept-cancel", take("g_cancel", "driver_b"), central_cancel("g_cancel")))
    state(f"select status||':'||logistics_status from public.market_orders where id={order('g_cancel')};", "cancelled:cancelled")
    state(f"select count(*) from public.rides where id={rx('g_cancel')};", "0")
    state(f"select count(*) from public.market_order_events where order_id={order('g_cancel')} and event_type='delivery_admin_cancel';", "1")
    state(stock("partial"), "10")
    print("G APROVADO (cancelamento) — intervenção concorrente preservou histórico e liberou estoque.", flush=True)

    expire_order = json.loads(lab.run(db, as_service(checkout("partial", "buyer_a", "g-expire"))))["orderId"]
    require(prepare("g_expire", expire_order), "Não foi possível preparar G/expiração.")
    lab.run(db, f"""
      update public.ride_requests set expires_at=clock_timestamp()-interval '1 second' where ride_id={rx('g_expire')};
      update public.market_orders set dispatch_next_at=null where id={order('g_expire')};
    """)
    signal(lab.race(db, "accept-expired", take("g_expire", "driver_b"), dispatch("g_expire")), 0)
    state(f"select count(*) from public.ride_requests where ride_id={rx('g_expire')} and status='expired';", "1")
    state(f"select logistics_status from public.market_orders where id={order('g_expire')};", "awaiting_driver")
    print("G APROVADO (expiração) — aceite atrasado e expiração concorrente não confirmaram entrega.", flush=True)

    accept = f"select public.market_transition_order({ident('merchant')},{order('staff')},'accept');"
    reject = f"select public.market_transition_order({ident('staff')},{order('staff')},'reject','Motivo sintético');"
    errors(lab.race(db, "staff", accept, reject), "MARKET_TRANSITION_INVALID")
    state(f"select count(*) from public.market_order_events where order_id={order('staff')} and event_type in ('order.preparing','order.rejected');", "1")
    print("H APROVADO — duas sessões da loja não aplicaram decisões conflitantes.", flush=True)

    cancel = f"select public.market_cancel_order({ident('buyer_a')},{order('expiry')},'Pedido de teste');"
    errors(lab.race(db, "stock-release", cancel, "select public.market_expire_orders();"))
    state(stock("expiry"), "1")
    state(f"select count(*) from public.market_order_events where order_id={order('expiry')} and event_type in ('order.expired','order.cancelled');", "1")
    print("I APROVADO — cancelamento/expiração liberaram estoque uma única vez.", flush=True)

    # The outbound network is never called. Exercise the same compare-and-set
    # conditions used by the dispatcher's PostgREST updates under real contention.
    lab.run(db, f"""
      insert into public.push_subscriptions(user_id,endpoint,p256dh,auth,active)
      values({ident('buyer_a')},'https://push.example.test/moto-audit','synthetic','synthetic',true);
      insert into public.notifications(user_id,type,title,body)
      values({ident('buyer_a')},'audit.local','Fixture de teste','Aviso sintético');
    """)
    queued = "(select d.id from public.notification_push_deliveries d join public.notifications n on n.id=d.notification_id where n.type='audit.local')"
    claim = f"""
      update public.notification_push_deliveries set status='processing',attempts=1,next_attempt_at=now()+interval '5 minutes'
      where id={queued} and attempts=0 and status in ('pending','processing','retry') and next_attempt_at<=now()
      returning true;
    """
    signal(lab.race(db, "push-claim", claim, claim), 1)
    state(f"select status||':'||attempts from public.notification_push_deliveries where id={queued};", "processing:1")
    print("J APROVADO (fila Push SQL) — uma reivindicação da entrega, nenhum envio externo.", flush=True)

    pause = "reset role; update private.marketplace_operation_environment set enabled=false where singleton;"
    racing_checkout = lab.race(db, "operation-pause", pause, checkout("idem", "buyer_b", "during-pause"))
    require(racing_checkout[0].returncode == 0, "Pausa pelo proprietário falhou.")
    require(racing_checkout[1].returncode == 0 or "MARKETPLACE_OPERATIONS_PAUSED" in racing_checkout[1].stderr,
            "Conflito inesperado entre pausa e checkout.")
    blocked = lab.run(db, as_service(checkout("idem", "buyer_b", "after-pause")), ok=False)
    require(blocked.returncode != 0 and "MARKETPLACE_OPERATIONS_PAUSED" in blocked.stderr, "Checkout após pausa não foi bloqueado.")
    print("Pausa APROVADA — concorrência com checkout consistente e novas compras bloqueadas.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--psql", type=Path, required=True)
    parser.add_argument("--password-file", type=Path, required=True)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--cluster-name", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--run", required=True, help="Sufixo novo de até 12 letras/dígitos.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--upgrade-only", action="store_true", help="Repetir só a instalação anterior e a atualização com dados.")
    mode.add_argument("--roles-only", action="store_true", help="Validar em banco novo somente os papéis efetivos e os controles financeiros.")
    args = parser.parse_args()
    require(bool(re.fullmatch("motopombal-audit-[0-9]{8}", args.cluster_name)) and 1024 < args.port < 65536
            and bool(re.fullmatch("[a-z0-9]{1,12}", args.run)), "Use nomes e porta de laboratório.")
    files = sorted(MIGRATIONS.glob("*.sql"))
    require(len({file.name[:14] for file in files}) == len(files) and len(files) >= 25, "Histórico de migrations incompleto ou ambíguo.")
    lab = Lab(args)
    print(f"PostgreSQL descartável {lab.guard('postgres')} em 127.0.0.1:{args.port}; identidade confirmada.", flush=True)
    clean, upgrade = [f"motopombal_audit_{stage}_{args.run}" for stage in ["clean", "upgrade"]]
    fixture = "set marketplace.test_isolated='disposable-local-postgres';\n" + (
        ROOT / "tests" / "marketplace-concurrency-fixture.sql").read_text(encoding="utf-8")
    def verify_roles():
        source = (ROOT / "tests" / "marketplace-effective-roles.sql").read_text(encoding="utf-8")
        evidence = lab.run(clean, "set marketplace.test_isolated='disposable-local-postgres';\n" + source)
        for marker in ("RLS_PII_PRIVILEGES_OK", "ANON_RESTRICTED_OK", "CASH_SETTLEMENT_AUDIT_OK", "STORAGE_POLICY_FIXTURE_OK"):
            require(marker in evidence.splitlines(), f"Evidência ausente: {marker}")
        print("Papéis efetivos APROVADOS — cliente, lojista, motoboy, anônimo, RLS e repasse; fixture Storage SQL.", flush=True)

    if not args.upgrade_only:
        lab.make_db(clean)
        require(lab.apply(clean, files) == len(files) and lab.apply(clean, files) == 0, "Histórico limpo não passou.")
        print(f"Instalação limpa APROVADA: {len(files)} migrations; verificação seguinte registrou zero pendentes.", flush=True)
    if args.roles_only:
        lab.run(clean, fixture)
        verify_roles()
        return
    lab.make_db(upgrade)
    former = [file for file in files if file.name[:14] < BASELINE_CUTOFF]
    pre_finance = [file for file in files if file.name[:14] < FINANCIAL_ROLLOUT_CUTOFF]
    require(lab.apply(upgrade, former) == len(former), "Schema anterior não aplicado.")
    lab.run(upgrade, LEGACY)
    require(lab.apply(upgrade, pre_finance) == len(pre_finance) - len(former), "Marketplace pré-financeiro não instalado.")
    lab.run(upgrade, fixture)
    snapshot = """
      select md5(jsonb_build_object(
        'orders',(select jsonb_agg(to_jsonb(o) order by id) from public.market_orders o),
        'items',(select jsonb_agg(to_jsonb(i) order by id) from public.market_order_items i),
        'events',(select jsonb_agg(to_jsonb(e) order by id) from public.market_order_events e),
        'cash',(select jsonb_agg((to_jsonb(p) - array['received_amount_cents','settled_amount_cents','receipt_reference','settlement_reference']) order by order_id)
            from public.market_cash_payments p),
        'reservations',(select jsonb_agg(to_jsonb(r) order by order_id,product_id) from public.market_stock_reservations r)
      )::text);
    """
    before = lab.run(upgrade, snapshot)
    prepared = [file for file in files if file.name[:14] <= FINANCIAL_ROLLOUT_CUTOFF]
    require(lab.apply(upgrade, prepared) == 1, "Fase de preparação financeira não aplicada.")
    cash_granted = "select has_function_privilege('service_role','public.market_record_cash_action(uuid,uuid,text,integer,text,text)','EXECUTE');"
    require(lab.run(upgrade, cash_granted) == "f", "A fase de preparação autorizou gravação de caixa.")
    require(lab.apply(upgrade, files) == len(files) - len(prepared) and lab.apply(upgrade, files) == 0, "Atualização não registrada.")
    require(lab.run(upgrade, cash_granted) == "t", "Guarda da operação não expôs o contrato de caixa.")
    kept = lab.run(upgrade, """select string_agg(service_type||':'||fare_cents::text||':'||(market_order_id is null)::text,',' order by service_type)
       from public.rides where market_order_id is null;""")
    require(kept == "delivery:700:true,passenger:500:true", "Corridas anteriores foram alteradas na atualização.")
    require(lab.run(upgrade, snapshot) == before, "Pedidos, estoque ou caixa já registrados foram alterados.")
    require(lab.run(upgrade, """select count(*) from public.market_cash_payments where received_at is not null
        and received_amount_cents is null and settled_amount_cents is null;""") == "1", "O registro legado deve manter o valor desconhecido.")
    require(lab.run(upgrade, """select public.market_confirm_operation_environment(
        '794382dd-bec6-4420-9745-56c27410e718','isolated_test');""") == "f", "A migração armou Compras sem autorização.")
    print("Atualização APROVADA: transporte, entrega e pedidos de Compras sintéticos preservados; zero pendentes.", flush=True)
    if not args.upgrade_only:
        lab.guard(clean)
        lab.run(clean, fixture)
        verify_roles()
        verify_races(lab, clean)


if __name__ == "__main__":
    main()
