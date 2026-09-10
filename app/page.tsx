import { redirect } from "next/navigation";
import { TaskManager } from "@/components/task-manager";
import { requireViewer } from "@/lib/auth";
import { demoClients, demoSettings, demoTasks, demoViewer } from "@/lib/demo-data";
import { isSupabaseConfigured } from "@/lib/env";
import { loadWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true" || !isSupabaseConfigured();
  if (demoMode) {
    return (
      <TaskManager
        initialTasks={demoTasks}
        clients={demoClients}
        viewer={demoViewer}
        initialSettings={demoSettings}
        demoMode
      />
    );
  }

  let viewer;
  try {
    viewer = await requireViewer();
  } catch {
    redirect("/login");
  }
  const workspace = await loadWorkspace(viewer);
  return (
    <TaskManager
      initialTasks={workspace.tasks}
      clients={workspace.clients}
      viewer={viewer}
      initialSettings={workspace.settings}
    />
  );
}
