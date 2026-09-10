import { z } from "zod";
import { classifyTask, toJarvisOutput } from "@/lib/ai/classifier";
import { requireDeveloper, requireViewer } from "@/lib/auth";
import { ApiError, jsonError, parseJson } from "@/lib/http";

const inputSchema = z.object({
  tarefa: z.string().trim().min(3).max(240),
  prazo_estimado_segundos: z.number().int().positive().max(359_999_999),
  tempo_real_gasto_segundos: z.number().int().nonnegative().max(359_999_999).nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    requireDeveloper(viewer);
    const input = await parseJson(request, inputSchema);
    let classification;
    try {
      classification = await classifyTask({
        title: input.tarefa,
        estimatedDurationSeconds: input.prazo_estimado_segundos,
        actualDurationSeconds: input.tempo_real_gasto_segundos,
      });
    } catch (error) {
      console.error("Task classification failed", error);
      throw new ApiError(502, "CLASSIFICATION_FAILED", "A classificação automática está indisponível. Tente novamente.");
    }
    return Response.json(toJarvisOutput(classification));
  } catch (error) {
    return jsonError(error);
  }
}
