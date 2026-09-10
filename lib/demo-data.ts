import type { ClientSummary, TaskView, Viewer, WorkspaceSettings } from "@/lib/types";

export const demoClients: ClientSummary[] = [
  { id: "make-one", name: "Make One", color: "#3478f6" },
  { id: "aurora", name: "Aurora Studio", color: "#af52de" },
  { id: "norte", name: "Norte Café", color: "#ff9f0a" },
];

export const demoViewer: Viewer = {
  id: "demo-user",
  name: "Thiago",
  role: "developer",
  agencyId: "demo-agency",
};

export const demoSettings: WorkspaceSettings = {
  agencyName: "Thigas Studio",
  currencyCode: "BRL",
  pointValueCents: 400,
};

export const demoTasks: TaskView[] = [
  {
    id: "demo-1",
    title: "Configurar o GA4 e validar eventos de conversão",
    clientId: "make-one",
    clientName: "Make One",
    clientColor: "#3478f6",
    status: "in_progress",
    complexityLevel: 2,
    basePoints: 8,
    efficiencyAdjustment: 0,
    points: 8,
    estimatedDurationSeconds: 7200,
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    completedAt: null,
    activeTimerStartedAt: null,
    trackedSeconds: 3_842,
    manualDurationSeconds: null,
    classificationStatus: "classified",
  },
  {
    id: "demo-2",
    title: "Criar landing page da campanha de primavera",
    clientId: "aurora",
    clientName: "Aurora Studio",
    clientColor: "#af52de",
    status: "open",
    complexityLevel: 3,
    basePoints: 25,
    efficiencyAdjustment: 0,
    points: 25,
    estimatedDurationSeconds: 28800,
    dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    completedAt: null,
    activeTimerStartedAt: null,
    trackedSeconds: 0,
    manualDurationSeconds: null,
    classificationStatus: "classified",
  },
  {
    id: "demo-3",
    title: "Atualizar horário de funcionamento no site",
    clientId: "norte",
    clientName: "Norte Café",
    clientColor: "#ff9f0a",
    status: "completed",
    complexityLevel: 1,
    basePoints: 2,
    efficiencyAdjustment: 1,
    points: 3,
    estimatedDurationSeconds: 3600,
    dueAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date().toISOString(),
    activeTimerStartedAt: null,
    trackedSeconds: 1_126,
    manualDurationSeconds: 900,
    classificationStatus: "classified",
  },
];
