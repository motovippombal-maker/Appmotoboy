import { z } from "zod";
import { audit, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { dispatchPushQueue } from "@/lib/backend/push";

const pauseSchema = z.object({ paused: z.boolean() });

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["driver"]);
    const { data: setting, error: settingError } = await supabase.from("system_settings")
      .select("value").eq("key", "dispatch").single();
    if (settingError) throw settingError;
    const mode = setting.value?.mode_switch_ready === true && setting.value?.mode === "broadcast"
      ? "broadcast" : "round_robin";
    const { data: queue, error } = await supabase.rpc(
      mode === "round_robin" ? "observe_driver_queue" : "driver_queue_snapshot",
      { p_driver_id: user.id },
    );
    if (error) throw error;
    if (mode === "round_robin" && queue?.notificationId) {
      try { await dispatchPushQueue(20, [queue.notificationId]); } catch { /* A fila continua disponível sem Push. */ }
    }
    return Response.json({ queue: { ...queue, mode } });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["driver"]);
    await consumeRateLimit(supabase, `driver-queue:${user.id}`, 10, 60);
    const { paused } = pauseSchema.parse(await request.json());
    const { data: queue, error } = await supabase.rpc("set_driver_queue_paused", {
      p_driver_id: user.id, p_paused: paused,
    });
    if (error) throw error;
    await audit(supabase, user.id, paused ? "driver.queue_paused" : "driver.queue_resumed", "driver", user.id);
    return Response.json({ queue });
  } catch (error) { return jsonError(error); }
}
