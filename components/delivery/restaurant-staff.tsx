"use client";

import { useCallback, useEffect, useState } from "react";
import { deliveryApi } from "@/lib/delivery/client";

type Staff = {
  user_id: string;
  role: "owner" | "manager" | "staff";
  profiles: { full_name: string; phone: string | null } | null;
};

export function RestaurantStaff({ restaurantId }: { restaurantId: string }) {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [myRole, setMyRole] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"manager" | "staff">("staff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    const result = await deliveryApi<{ staff: Staff[]; myRole: string }>(
      `/api/restaurant/${restaurantId}/staff`,
    );
    setStaff(result.staff);
    setMyRole(result.myRole);
  }, [restaurantId]);
  useEffect(() => {
    void Promise.resolve()
      .then(() => refresh())
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : "Equipe indisponível.",
        ),
      );
  }, [refresh]);
  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await deliveryApi(`/api/restaurant/${restaurantId}/staff`, {
        method: "POST",
        body: JSON.stringify({ phone, role }),
      });
      setPhone("");
      await refresh();
      setMessage("Pessoa adicionada à equipe.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível adicionar.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove(userId: string) {
    if (!window.confirm("Remover esta pessoa da equipe?")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await deliveryApi(`/api/restaurant/${restaurantId}/staff`, {
        method: "DELETE",
        body: JSON.stringify({ userId }),
      });
      await refresh();
      setMessage("Acesso removido.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível remover.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="delivery-panel">
      <h2>Equipe do restaurante</h2>
      <p>
        Use o telefone de uma conta MotoPombal já cadastrada. Gerentes podem
        operar o restaurante; atendentes podem gerir cardápio e pedidos.
      </p>
      {error && (
        <p className="delivery-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="delivery-success" role="status">
          {message}
        </p>
      )}
      {staff.map((person) => (
        <div className="delivery-list-row" key={person.user_id}>
          <span>
            <b>{person.profiles?.full_name || "Conta MotoPombal"}</b>
            <small>
              {person.profiles?.phone || "Sem telefone"} ·{" "}
              {person.role === "owner"
                ? "Proprietário"
                : person.role === "manager"
                  ? "Gerente"
                  : "Atendente"}
            </small>
          </span>
          {myRole === "owner" && person.role !== "owner" && (
            <button
              type="button"
              className="delivery-danger"
              disabled={busy}
              onClick={() => void remove(person.user_id)}
            >
              Remover
            </button>
          )}
        </div>
      ))}
      {myRole === "owner" && (
        <form
          className="delivery-inline-form"
          onSubmit={(event) => void add(event)}
        >
          <label>
            Telefone com DDD
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              required
              placeholder="(75) 99999-9999"
            />
          </label>
          <label>
            Permissão
            <select
              value={role}
              onChange={(event) =>
                setRole(event.target.value as "manager" | "staff")
              }
            >
              <option value="staff">Atendente</option>
              <option value="manager">Gerente</option>
            </select>
          </label>
          <button className="delivery-secondary" disabled={busy}>
            Adicionar à equipe
          </button>
        </form>
      )}
    </div>
  );
}
