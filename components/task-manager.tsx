"use client";

import {
  BriefcaseBusiness,
  CalendarClock,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Copy,
  Download,
  LayoutDashboard,
  ListTodo,
  LoaderCircle,
  Mic,
  Moon,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  UserRoundPlus,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  createDefaultDeadline,
  dateKeyAtTimeZone,
  deadlineInputToIso,
  formatDeadline,
  isFutureDeadline,
  toDateTimeLocalValue,
} from "@/lib/domain/deadline";
import { calculateAmountCents, calculateEfficiencyScore, formatCurrency } from "@/lib/domain/points";
import { groupTasksByDeadline } from "@/lib/domain/task-groups";
import { TASK_SUGGESTION_CATEGORY_LABELS } from "@/lib/domain/task-suggestions";
import { effectiveDuration, formatDuration, parseDuration } from "@/lib/domain/time";
import { generateBillingReport, reportToCsv } from "@/lib/reports/generate";
import { useSpeechDictation } from "@/lib/browser/use-speech-dictation";
import { formatAiErrorLog, readAiErrorDiagnostic, type AiErrorDiagnostic } from "@/lib/ai/error-diagnostics";
import type {
  AppRole,
  ClientSummary,
  TaskView,
  TaskSuggestion,
  Viewer,
  WorkspaceSettings,
} from "@/lib/types";

interface TaskManagerProps {
  initialTasks: TaskView[];
  clients: ClientSummary[];
  viewer: Viewer;
  initialSettings: WorkspaceSettings;
  demoMode?: boolean;
}

type ViewMode = "developer" | "agency";

type TaskMutator = (
  id: string,
  action: () => Promise<TaskView>,
  fallback: (task: TaskView) => TaskView,
  options?: { optimistic?: boolean },
) => Promise<boolean>;

interface JarvisUiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  diagnostic?: AiErrorDiagnostic | null;
}

const ACTIVE_TIMER_FAVICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#FF3B30"/></svg>',
)}`;

function useTimerFavicon(hasRunningTimer: boolean) {
  useEffect(() => {
    const favicon = document.createElement("link");
    favicon.id = "task-status-favicon";
    favicon.rel = "icon";
    favicon.type = "image/svg+xml";
    document.head.append(favicon);

    return () => favicon.remove();
  }, []);

  useEffect(() => {
    const favicon = document.querySelector<HTMLLinkElement>("#task-status-favicon");
    if (favicon) favicon.href = hasRunningTimer ? ACTIVE_TIMER_FAVICON : "/icon.svg";
  }, [hasRunningTimer]);
}

class ApiRequestError extends Error {
  constructor(message: string, public readonly diagnostic: AiErrorDiagnostic | null = null) {
    super(message);
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as T & { error?: { message?: string; details?: { diagnostic?: unknown } } };
  if (!response.ok) {
    throw new ApiRequestError(
      body.error?.message ?? "Não foi possível concluir a ação.",
      readAiErrorDiagnostic(body.error?.details?.diagnostic),
    );
  }
  return body;
}

function JarvisErrorDiagnostic({ diagnostic }: { diagnostic: AiErrorDiagnostic }) {
  const [copied, setCopied] = useState(false);

  async function copyDiagnostic() {
    const log = formatAiErrorLog(diagnostic);
    try {
      await navigator.clipboard.writeText(log);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = log;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  return (
    <div className={`jarvis-error-diagnostic category-${diagnostic.category}`}>
      <strong>{diagnostic.title}</strong>
      <p>{diagnostic.message}</p>
      <code>{diagnostic.provider} · HTTP {diagnostic.status ?? "N/D"} · {diagnostic.code} · {diagnostic.referenceId}</code>
      <button type="button" onClick={() => void copyDiagnostic()} aria-label="Copiar diagnóstico do Jarvis">
        {copied ? <Check /> : <Copy />}
        {copied ? "Copiado" : "Copiar diagnóstico"}
      </button>
    </div>
  );
}

function billingWindow(now = new Date()): { start: Date; end: Date } {
  const thisMonth15 = new Date(now.getFullYear(), now.getMonth(), 15);
  const end = now >= thisMonth15
    ? new Date(now.getFullYear(), now.getMonth() + 1, 15)
    : thisMonth15;
  const start = new Date(end.getFullYear(), end.getMonth() - 1, 15);
  return { start, end };
}

export function TaskManager({
  initialTasks,
  clients,
  viewer,
  initialSettings,
  demoMode = false,
}: TaskManagerProps) {
  const [tasks, setTasks] = useState(initialTasks);
  const [clientList, setClientList] = useState(clients);
  const [settings, setSettingsState] = useState(initialSettings);
  const [view, setView] = useState<ViewMode>(viewer.role === "agency" ? "agency" : "developer");
  const [selectedClient, setSelectedClient] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clientsOpen, setClientsOpen] = useState(false);
  const [jarvisOpen, setJarvisOpen] = useState(false);
  const [dark, setDark] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const hasRunningTimer = tasks.some((task) => Boolean(task.activeTimerStartedAt));

  useTimerFavicon(hasRunningTimer);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const stored = window.localStorage.getItem("theme");
      setDark(stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (dark === null) return;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  const filteredTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          (selectedClient === "all" || task.clientId === selectedClient) &&
          task.title.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")),
      ),
    [search, selectedClient, tasks],
  );

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3_000);
  }

  function upsertResolvedClient(client: ClientSummary) {
    setClientList((current) => {
      const withoutCurrent = current.filter((item) => item.id !== client.id);
      return [...withoutCurrent, client].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    });
  }

  async function mutateTask(
    id: string,
    action: () => Promise<TaskView>,
    fallback: (task: TaskView) => TaskView,
    options: { optimistic?: boolean } = {},
  ): Promise<boolean> {
    const previous = tasks;
    const optimistic = options.optimistic !== false;
    if (optimistic || demoMode) {
      setTasks((current) => current.map((task) => (task.id === id ? fallback(task) : task)));
    }
    if (demoMode) return true;
    try {
      const updated = await action();
      setTasks((current) => current.map((task) => (task.id === id ? updated : task)));
      return true;
    } catch (error) {
      if (optimistic) setTasks(previous);
      if (error instanceof ApiRequestError && error.diagnostic) {
        setTasks((current) => current.map((task) => task.id === id
          ? { ...task, classificationStatus: "failed", classificationError: error.diagnostic }
          : task));
      }
      showNotice(error instanceof ApiRequestError && error.diagnostic ? error.diagnostic.title : error instanceof Error ? error.message : "Ação não concluída.");
      return false;
    }
  }

  async function createWorkspaceClient(input: { name: string; color: string }): Promise<ClientSummary> {
    const client = demoMode
      ? { id: crypto.randomUUID(), ...input }
      : (await requestJson<{ client: ClientSummary }>("/api/clients", {
          method: "POST",
          body: JSON.stringify(input),
        })).client;
    setClientList((current) => [...current, client].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
    return client;
  }

  async function updateWorkspaceClient(id: string, input: { name: string; color: string }): Promise<ClientSummary> {
    const client = demoMode
      ? { id, ...input }
      : (await requestJson<{ client: ClientSummary }>(`/api/clients/${id}`, {
          method: "PATCH",
          body: JSON.stringify(input),
        })).client;
    setClientList((current) => current.map((item) => item.id === id ? client : item).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
    setTasks((current) => current.map((task) => task.clientId === id
      ? { ...task, clientName: client.name, clientColor: client.color }
      : task));
    return client;
  }

  async function removeWorkspaceClient(id: string): Promise<void> {
    if (!demoMode) {
      await requestJson<{ removedClientId: string }>(`/api/clients/${id}`, { method: "DELETE" });
    }
    setClientList((current) => current.filter((client) => client.id !== id));
    setSelectedClient((current) => current === id ? "all" : current);
  }

  async function removeTask(id: string): Promise<void> {
    try {
      if (!demoMode) {
        await requestJson<{ removedTaskId: string }>(`/api/tasks/${id}`, { method: "DELETE" });
      }
      setTasks((current) => current.filter((task) => task.id !== id));
      showNotice("Tarefa excluída.");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Não foi possível excluir a tarefa.");
      throw error;
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark small">T</div>
          <div><strong>Thigas</strong><span>{settings.agencyName}</span></div>
        </div>

        <nav className="nav-stack" aria-label="Navegação principal">
          <button className={view === "developer" ? "active" : ""} onClick={() => setView("developer")} disabled={viewer.role === "agency"}>
            <ListTodo /> Desenvolvedor
          </button>
          <button className={view === "agency" ? "active" : ""} onClick={() => setView("agency")}>
            <LayoutDashboard /> Agência
          </button>
        </nav>

        <div className="sidebar-section">
          <div className="sidebar-section-head"><p>CLIENTES</p>{viewer.role === "developer" && <button className="clients-manage-trigger" onClick={() => { setClientsOpen(true); setSettingsOpen(false); setJarvisOpen(false); }} aria-label="Gerenciar clientes"><Plus /></button>}</div>
          <button className={selectedClient === "all" ? "client-active" : ""} onClick={() => setSelectedClient("all")}>
            <span className="client-dot all"><BriefcaseBusiness /></span> Todos
            <em>{tasks.length}</em>
          </button>
          {clientList.map((client) => (
            <button key={client.id} className={selectedClient === client.id ? "client-active" : ""} onClick={() => setSelectedClient(client.id)}>
              <span className="client-dot" style={{ background: client.color }} /> {client.name}
              <em>{tasks.filter((task) => task.clientId === client.id).length}</em>
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          {demoMode && <span className="demo-pill">Modo demonstração</span>}
          {viewer.role === "developer" && <button onClick={() => { setClientsOpen(true); setSettingsOpen(false); setJarvisOpen(false); }}><Users /> Gerenciar clientes</button>}
          <button onClick={() => { setSettingsOpen(true); setClientsOpen(false); setJarvisOpen(false); }}><Settings /> Ajustes</button>
          <div className="profile-row">
            <span className="avatar">{viewer.name.slice(0, 2).toUpperCase()}</span>
            <div><strong>{viewer.name}</strong><span>{roleLabel(viewer.role)}</span></div>
            <MoreHorizontal />
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark small">T</div><strong>Thigas</strong></div>
          <div className="search-box"><Search /><input aria-label="Buscar tarefas" placeholder="Buscar tarefas..." value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <div className="top-actions">
            {viewer.role === "developer" && !demoMode && <button className="jarvis-trigger" onClick={() => { setJarvisOpen(true); setSettingsOpen(false); setClientsOpen(false); }}><Sparkles /><span>Jarvis</span></button>}
            <button className="icon-button theme-control" onClick={() => setDark((value) => !(value ?? false))} aria-label="Alternar tema">{dark ? <><Sun /><span>Light</span></> : <><Moon /><span>Dark</span></>}</button>
            {viewer.role === "developer" && <button className="icon-button mobile-clients" onClick={() => { setClientsOpen(true); setSettingsOpen(false); setJarvisOpen(false); }} aria-label="Gerenciar clientes"><Users /></button>}
            <button className="icon-button mobile-settings" onClick={() => { setSettingsOpen(true); setClientsOpen(false); setJarvisOpen(false); }} aria-label="Abrir ajustes"><Settings /></button>
          </div>
        </header>

        <nav className="mobile-view-switch" aria-label="Alternar visão">
          <button className={view === "developer" ? "active" : ""} onClick={() => setView("developer")} disabled={viewer.role === "agency"}><ListTodo /> Desenvolvedor</button>
          <button className={view === "agency" ? "active" : ""} onClick={() => setView("agency")}><LayoutDashboard /> Agência</button>
        </nav>

        {view === "developer" ? (
          <DeveloperView
            tasks={filteredTasks}
            allTasks={tasks}
            clients={clientList}
            settings={settings}
            demoMode={demoMode}
            onTasksChange={setTasks}
            onMutateTask={mutateTask}
            onRemoveTask={removeTask}
            onClientResolved={upsertResolvedClient}
            onNotice={showNotice}
          />
        ) : (
          <AgencyView
            tasks={filteredTasks}
            settings={settings}
            demoMode={demoMode}
            onMutateTask={mutateTask}
          />
        )}
      </section>

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          demoMode={demoMode}
          onClose={() => setSettingsOpen(false)}
          onSave={(next) => { setSettingsState(next); setSettingsOpen(false); showNotice("Ajustes salvos."); }}
        />
      )}
      {clientsOpen && viewer.role === "developer" && (
        <ClientManagerPanel
          clients={clientList}
          tasks={tasks}
          onClose={() => setClientsOpen(false)}
          onCreate={createWorkspaceClient}
          onUpdate={updateWorkspaceClient}
          onRemove={removeWorkspaceClient}
          onNotice={showNotice}
        />
      )}
      {viewer.role === "developer" && !demoMode && (
        <JarvisPanel
          open={jarvisOpen}
          onClose={() => setJarvisOpen(false)}
          onTaskCreated={(task, client, clientCreated) => {
            setTasks((current) => [task, ...current]);
            upsertResolvedClient(client);
            showNotice(clientCreated
              ? `Demanda adicionada e cliente ${client.name} criado pelo Jarvis.`
              : "Demanda adicionada pelo Jarvis.");
          }}
        />
      )}
      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}

function JarvisPanel({
  open,
  onClose,
  onTaskCreated,
}: {
  open: boolean;
  onClose: () => void;
  onTaskCreated: (task: TaskView, client: ClientSummary, clientCreated: boolean) => void;
}) {
  const [messages, setMessages] = useState<JarvisUiMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Olá! Conte a demanda, o cliente e o prazo de entrega. Se você não estimar o tempo, eu calculo; se o cliente não existir, eu cadastro.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const speech = useSpeechDictation({ value: input, onChange: setInput, language: "pt-BR", maxLength: 800 });

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (!content || sending || speech.listening) return;

    const userMessage: JarvisUiMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setSending(true);

    try {
      const result = await requestJson<{ message: string; task: TaskView | null; client?: ClientSummary | null; clientCreated?: boolean }>(
        "/api/jarvis/chat",
        {
          method: "POST",
          body: JSON.stringify({
            messages: nextMessages
              .filter((message) => message.id !== "welcome" && !message.diagnostic)
              .slice(-8)
              .map(({ role, content: text }) => ({ role, content: text })),
          }),
        },
      );
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: result.message },
      ]);
      if (result.task) {
        const resolvedClient = result.client ?? {
          id: result.task.clientId,
          name: result.task.clientName,
          color: result.task.clientColor,
        };
        onTaskCreated(result.task, resolvedClient, Boolean(result.clientCreated));
      }
    } catch (error) {
      const diagnostic = error instanceof ApiRequestError ? error.diagnostic : null;
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: diagnostic?.title ?? (error instanceof Error ? error.message : "Não consegui processar a mensagem. Tente novamente."),
          diagnostic,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function closePanel() {
    speech.cancel();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="drawer-backdrop" onMouseDown={closePanel}>
      <aside className="jarvis-drawer" onMouseDown={(event) => event.stopPropagation()} aria-label="Conversa com Jarvis">
        <div className="jarvis-head">
          <div className="jarvis-identity"><span><Sparkles /></span><div><strong>Jarvis</strong><small>Analista de demandas</small></div></div>
          <button onClick={closePanel} aria-label="Fechar Jarvis"><X /></button>
        </div>
        <div className="jarvis-messages" aria-live="polite">
          {messages.map((message) => (
            <div className={`jarvis-message ${message.role}`} key={message.id}>
              {message.role === "assistant" && <span className="jarvis-avatar"><Sparkles /></span>}
              <div className="jarvis-message-content">
                {message.diagnostic
                  ? <JarvisErrorDiagnostic diagnostic={message.diagnostic} />
                  : <p>{message.content}</p>}
              </div>
            </div>
          ))}
          {sending && <div className="jarvis-message assistant"><span className="jarvis-avatar"><Sparkles /></span><div className="jarvis-message-content"><p className="jarvis-thinking"><i /><i /><i /></p></div></div>}
          <div ref={messagesEnd} />
        </div>
        <form className="jarvis-composer" onSubmit={sendMessage}>
          <textarea
            aria-label="Mensagem para o Jarvis"
            value={input}
            readOnly={speech.listening}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ex.: Jarvis, crie uma demanda de GA4 para a Make One..."
            maxLength={800}
            rows={3}
          />
          <div className="jarvis-composer-actions">
            <span className={speech.error ? "speech-error" : speech.listening ? "speech-listening" : ""} role={speech.error ? "alert" : "status"}>
              {speech.error ?? (speech.listening ? "Ouvindo... toque no microfone para parar" : "Digite ou dite sua demanda")}
            </span>
            <div className="jarvis-composer-buttons">
              <button
                type="button"
                className={`dictation-button ${speech.listening ? "listening" : ""}`}
                onClick={speech.toggle}
                disabled={sending || !speech.supported}
                aria-label={speech.listening ? "Parar ditado" : "Ditar demanda"}
                aria-pressed={speech.listening}
                title={speech.supported ? "Ditar demanda em português" : "Ditado não disponível neste navegador"}
              ><Mic /></button>
              <button className="send-button" type="submit" disabled={sending || speech.listening || !input.trim()} aria-label="Enviar mensagem">{sending ? <LoaderCircle className="spin" /> : <Send />}</button>
            </div>
          </div>
        </form>
      </aside>
    </div>
  );
}

function DeveloperView({
  tasks,
  allTasks,
  clients,
  settings,
  demoMode,
  onTasksChange,
  onMutateTask,
  onRemoveTask,
  onClientResolved,
  onNotice,
}: {
  tasks: TaskView[];
  allTasks: TaskView[];
  clients: ClientSummary[];
  settings: WorkspaceSettings;
  demoMode: boolean;
  onTasksChange: React.Dispatch<React.SetStateAction<TaskView[]>>;
  onMutateTask: TaskMutator;
  onRemoveTask: (id: string) => Promise<void>;
  onClientResolved: (client: ClientSummary) => void;
  onNotice: (message: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [currentDate] = useState(() => new Date());
  const [adding, setAdding] = useState(false);
  const timezone = settings.timezone ?? "America/Sao_Paulo";

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const now = new Date();
      setDueAt((current) => current || createDefaultDeadline(now));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);
  const hasInvalidEstimate = estimatedHours.trim() !== "" && (
    !Number.isFinite(Number(estimatedHours)) || Number(estimatedHours) <= 0
  );
  const openTasks = tasks.filter((task) => task.status !== "completed" && task.status !== "approved");
  const openTaskGroups = groupTasksByDeadline(openTasks, currentDate, timezone);
  const completedTasks = tasks.filter((task) => task.status === "completed" || task.status === "approved");
  const todayCompleted = currentDate
    ? allTasks.filter((task) => task.completedAt && dateKeyAtTimeZone(task.completedAt, timezone) === dateKeyAtTimeZone(currentDate, timezone)).length
    : 0;
  const effectiveClientId = clients.some((client) => client.id === clientId)
    ? clientId
    : demoMode ? clients[0]?.id ?? "" : "";

  async function addTask(event: React.FormEvent) {
    event.preventDefault();
    const cleanTitle = title.trim();
    const estimatedDurationSeconds = estimatedHours.trim()
      ? Math.round(Number(estimatedHours) * 3600)
      : null;
    if (
      !cleanTitle ||
      (estimatedDurationSeconds !== null && (!Number.isInteger(estimatedDurationSeconds) || estimatedDurationSeconds <= 0))
    ) return;
    let dueAtIso: string;
    try {
      dueAtIso = deadlineInputToIso(dueAt);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Informe um prazo válido.");
      return;
    }
    setAdding(true);
    try {
      let created: TaskView;
      if (demoMode) {
        const client = clients.find((item) => item.id === effectiveClientId)!;
        const demoEstimatedDurationSeconds = estimatedDurationSeconds ?? 8 * 3600;
        created = {
          id: crypto.randomUUID(), title: cleanTitle, clientId: effectiveClientId, clientName: client.name,
          description: description.trim() || null,
          clientColor: client.color, status: "open", complexityLevel: 2,
          completionSummary: null, completionRationale: null,
          basePoints: 8, efficiencyAdjustment: 0, executionAdjustment: 0, points: 8, estimatedDurationSeconds: demoEstimatedDurationSeconds,
          dueAt: dueAtIso, completedAt: null, activeTimerStartedAt: null, trackedSeconds: 0,
          manualDurationSeconds: null, classificationStatus: "classified",
        };
      } else {
        const result = await requestJson<{ task: TaskView; client?: ClientSummary; clientCreated?: boolean }>("/api/tasks", {
          method: "POST", body: JSON.stringify({ title: cleanTitle, description: description.trim() || null, clientId: effectiveClientId || null, estimatedDurationSeconds, dueAt: dueAtIso }),
        });
        created = result.task;
        const resolvedClient = result.client ?? {
          id: created.clientId,
          name: created.clientName,
          color: created.clientColor,
        };
        onClientResolved(resolvedClient);
        if (result.clientCreated) {
          onNotice(`Cliente ${resolvedClient.name} criado automaticamente pelo Jarvis.`);
        } else if (estimatedDurationSeconds === null) {
          onNotice(`Jarvis estimou o tempo necessário em ${formatDuration(created.estimatedDurationSeconds)}.`);
        }
      }
      onTasksChange((current) => [created, ...current]);
      if (demoMode && estimatedDurationSeconds === null) {
        onNotice(`Jarvis estimou o tempo necessário em ${formatDuration(created.estimatedDurationSeconds)}.`);
      }
      setTitle("");
      setDescription("");
      setEstimatedHours("");
      setDueAt(createDefaultDeadline());
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Não foi possível criar a tarefa.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="content-wrap">
      <div className="page-heading">
        <div><p className="eyebrow">MEU TRABALHO</p><h1>Hoje</h1><p>{currentDate ? new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, weekday: "long", day: "numeric", month: "long" }).format(currentDate) : "\u00A0"}</p></div>
        <div className="day-score"><Check /><div><strong>{todayCompleted}</strong><span>concluídas hoje</span></div></div>
      </div>

      <form className="quick-add" onSubmit={addTask}>
        <span className="add-circle"><Plus /></span>
        <div className="quick-add-copy">
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Adicionar nova demanda..." aria-label="Título da nova tarefa" maxLength={240} />
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descrição, anotações ou observações (opcional)" aria-label="Descrição da nova tarefa" maxLength={4000} rows={1} />
        </div>
        <div className="client-select-wrap">
          <span style={{ background: clients.find((client) => client.id === effectiveClientId)?.color ?? "#8e8e93" }} />
          <select aria-label="Cliente" value={clientId} onChange={(event) => setClientId(event.target.value)}>
            <option value="">Jarvis identifica</option>
            {clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}
          </select><ChevronDown />
        </div>
        <label className="estimate-input-wrap" title="Opcional: deixe vazio para o Jarvis estimar"><Clock3 /><input aria-label="Tempo previsto em horas" type="number" min="0.25" max="99999" step="0.25" placeholder="Jarvis" value={estimatedHours} onChange={(event) => setEstimatedHours(event.target.value)} /><span>h</span></label>
        <label className="deadline-input-wrap" title="Data e hora limite para concluir a tarefa"><CalendarClock /><input aria-label="Data e hora do prazo" type="datetime-local" required min={currentDate ? toDateTimeLocalValue(currentDate) : undefined} value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
        <button className="add-button" type="submit" disabled={adding || !title.trim() || (demoMode && !effectiveClientId) || hasInvalidEstimate || !isFutureDeadline(dueAt)}>{adding ? <LoaderCircle className="spin" /> : <><Sparkles /> Adicionar</>}</button>
      </form>

      <div className="list-toolbar"><span>{openTasks.length} pendentes</span><button><SlidersHorizontal /> Filtrar</button></div>
      {openTaskGroups.length > 0 ? (
        <div className="task-date-groups">
          {openTaskGroups.map((group) => (
            <section className={`task-date-group ${group.kind}`} key={group.id} aria-labelledby={`task-date-${group.id}`}>
              <div className="task-date-heading">
                <h2 id={`task-date-${group.id}`}>{group.label}</h2>
                <span>{group.tasks.length} {group.tasks.length === 1 ? "demanda" : "demandas"}</span>
              </div>
              <div className="task-list">
                {group.tasks.map((task) => <TaskRow key={task.id} task={task} clients={clients} settings={settings} demoMode={demoMode} onMutate={onMutateTask} onRemove={onRemoveTask} />)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="task-list"><EmptyState /></div>
      )}

      {completedTasks.length > 0 && (
        <details className="completed-group" open>
          <summary><ChevronDown /> Concluídas <span>{completedTasks.length}</span></summary>
          <div className="task-list completed-list">
            {completedTasks.map((task) => <TaskRow key={task.id} task={task} clients={clients} settings={settings} demoMode={demoMode} onMutate={onMutateTask} />)}
          </div>
        </details>
      )}
    </div>
  );
}

function TaskSuggestionsChecklist({
  suggestions,
  done,
  compact = false,
  savingId,
  evidenceDrafts,
  onEvidenceChange,
  onUpdate,
}: {
  suggestions: TaskSuggestion[];
  done: boolean;
  compact?: boolean;
  savingId: string | null;
  evidenceDrafts: Record<string, string>;
  onEvidenceChange: (id: string, value: string) => void;
  onUpdate: (suggestion: TaskSuggestion, status: TaskSuggestion["status"], evidence: string | null) => void;
}) {
  return (
    <div className={`suggestion-list ${compact ? "compact" : ""}`}>
      {suggestions.map((suggestion) => {
        const evidence = evidenceDrafts[suggestion.id] ?? suggestion.evidence ?? "";
        const checked = suggestion.status === "completed";
        const unavailable = suggestion.status === "not_applicable";
        return (
          <div className={`suggestion-item ${checked ? "completed" : ""} ${unavailable ? "not-applicable" : ""}`} key={suggestion.id}>
            <button
              type="button"
              className="suggestion-check"
              disabled={done || savingId === suggestion.id}
              aria-label={checked ? `Desmarcar ${suggestion.title}` : `Marcar ${suggestion.title} como realizado`}
              aria-pressed={checked}
              onClick={() => onUpdate(suggestion, checked ? "pending" : "completed", evidence)}
            >{savingId === suggestion.id ? <LoaderCircle className="spin" /> : checked ? <Check /> : null}</button>
            <div className="suggestion-copy">
              <div className="suggestion-title-row">
                <strong>{suggestion.title}</strong>
                <span className={`suggestion-category ${suggestion.category}`}>{TASK_SUGGESTION_CATEGORY_LABELS[suggestion.category]}</span>
                <b>+{suggestion.rewardPercentage}%</b>
                {suggestion.omissionPenaltyPercentage > 0 && <em>Se não fizer: −{suggestion.omissionPenaltyPercentage}%</em>}
              </div>
              <p>{suggestion.description}</p>
              {suggestion.tools.length > 0 && <small>Ferramentas sugeridas: {suggestion.tools.join(", ")}</small>}
              <div className="suggestion-proof-row">
                <input
                  aria-label={`Comprovação de ${suggestion.title}`}
                  value={evidence}
                  readOnly={done}
                  maxLength={1000}
                  placeholder={suggestion.evidenceRequired ? "Comprovação obrigatória: informe teste, link ou resultado" : "Comprovação opcional"}
                  onChange={(event) => onEvidenceChange(suggestion.id, event.target.value)}
                />
                {!done && (
                  <>
                    {evidence !== (suggestion.evidence ?? "") && <button type="button" onClick={() => onUpdate(suggestion, suggestion.status, evidence)}>Salvar comprovação</button>}
                    <button type="button" onClick={() => onUpdate(suggestion, unavailable ? "pending" : "not_applicable", evidence)}>
                      {unavailable ? "Reativar" : "Não se aplica"}
                    </button>
                  </>
                )}
              </div>
              {done && suggestion.verificationStatus !== "pending" && (
                <div className={`suggestion-verification ${suggestion.verificationStatus}`}>
                  {suggestion.verificationStatus === "verified" ? "Confirmado pelo Jarvis" : suggestion.verificationStatus === "not_applicable" ? "Dispensa aceita" : "Não confirmado"}
                  {suggestion.verificationRationale && ` — ${suggestion.verificationRationale}`}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskRow({ task, clients, settings, demoMode, onMutate, onRemove }: { task: TaskView; clients: ClientSummary[]; settings: WorkspaceSettings; demoMode: boolean; onMutate: TaskMutator; onRemove?: (id: string) => Promise<void> }) {
  const [editingTime, setEditingTime] = useState(false);
  const [timeInput, setTimeInput] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionInput, setDescriptionInput] = useState(task.description ?? "");
  const [editingDueAt, setEditingDueAt] = useState(false);
  const [dueAtInput, setDueAtInput] = useState("");
  const [editingClient, setEditingClient] = useState(false);
  const [clientIdInput, setClientIdInput] = useState(task.clientId);
  const [now, setNow] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionInput, setCompletionInput] = useState(task.completionSummary ?? "");
  const [preparingCompletion, setPreparingCompletion] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [reevaluating, setReevaluating] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<TaskSuggestion[] | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [savingSuggestionId, setSavingSuggestionId] = useState<string | null>(null);
  const [evidenceDrafts, setEvidenceDrafts] = useState<Record<string, string>>({});
  const completionSpeech = useSpeechDictation({
    value: completionInput,
    onChange: setCompletionInput,
    language: "pt-BR",
    maxLength: 4_000,
  });
  const done = task.status === "completed" || task.status === "approved";
  const running = Boolean(task.activeTimerStartedAt);

  useEffect(() => {
    const timeout = window.setTimeout(() => setNow(Date.now()), 0);
    const interval = window.setInterval(() => setNow(Date.now()), running ? 1_000 : 60_000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [running]);

  const seconds = effectiveDuration(task.trackedSeconds, task.manualDurationSeconds, task.activeTimerStartedAt, now);

  function demoSuggestions(): TaskSuggestion[] {
    return [
      { id: `${task.id}-1`, taskId: task.id, position: 1, title: "Validar antes de publicar", description: "Confira o resultado em computador e celular antes de colocar no ar.", category: "essential", rewardPercentage: 3, omissionPenaltyPercentage: 10, evidenceRequired: true, tools: [], status: "pending", evidence: null, verificationStatus: "pending", verificationRationale: null },
      { id: `${task.id}-2`, taskId: task.id, position: 2, title: "Registrar o que foi alterado", description: "Anote as principais mudanças para facilitar futuras consultas.", category: "recommended", rewardPercentage: 2, omissionPenaltyPercentage: 0, evidenceRequired: false, tools: [], status: "pending", evidence: null, verificationStatus: "pending", verificationRationale: null },
      { id: `${task.id}-3`, taskId: task.id, position: 3, title: "Fazer follow-up com o cliente", description: "Confirme se a entrega atende ao pedido e registre a resposta.", category: "follow_up", rewardPercentage: 1, omissionPenaltyPercentage: 0, evidenceRequired: false, tools: [], status: "pending", evidence: null, verificationStatus: "pending", verificationRationale: null },
    ];
  }

  async function ensureSuggestions(): Promise<TaskSuggestion[]> {
    if (suggestions) return suggestions;
    if (demoMode) {
      const sample = demoSuggestions();
      setSuggestions(sample);
      setEvidenceDrafts(Object.fromEntries(sample.map((item) => [item.id, item.evidence ?? ""])));
      return sample;
    }
    setLoadingSuggestions(true);
    setSuggestionsError(null);
    try {
      const method = done ? "GET" : "POST";
      const result = await requestJson<{ suggestions: TaskSuggestion[] }>(`/api/tasks/${task.id}/suggestions`, { method });
      setSuggestions(result.suggestions);
      setEvidenceDrafts(Object.fromEntries(result.suggestions.map((item) => [item.id, item.evidence ?? ""])));
      return result.suggestions;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível carregar as sugestões do Jarvis.";
      setSuggestionsError(message);
      throw error;
    } finally {
      setLoadingSuggestions(false);
    }
  }

  async function toggleSuggestions() {
    const nextOpen = !suggestionsOpen;
    setSuggestionsOpen(nextOpen);
    if (nextOpen && !suggestions && !loadingSuggestions) {
      try { await ensureSuggestions(); } catch { /* A mensagem aparece dentro da aba. */ }
    }
  }

  async function updateSuggestion(suggestion: TaskSuggestion, status: TaskSuggestion["status"], evidence: string | null) {
    if (done || savingSuggestionId) return;
    if (status === "not_applicable" && (!evidence || evidence.trim().length < 5)) {
      setSuggestionsError("Explique no campo de comprovação por que a sugestão não se aplica.");
      return;
    }
    setSavingSuggestionId(suggestion.id);
    setSuggestionsError(null);
    try {
      const updated = demoMode
        ? { ...suggestion, status, evidence: evidence?.trim() || null }
        : (await requestJson<{ suggestion: TaskSuggestion }>(`/api/tasks/${task.id}/suggestions/${suggestion.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status, evidence: evidence?.trim() || null }),
          })).suggestion;
      setSuggestions((current) => current?.map((item) => item.id === updated.id ? updated : item) ?? [updated]);
      setEvidenceDrafts((current) => ({ ...current, [updated.id]: updated.evidence ?? "" }));
    } catch (error) {
      setSuggestionsError(error instanceof Error ? error.message : "Não foi possível atualizar o checklist.");
    } finally {
      setSavingSuggestionId(null);
    }
  }

  function reopenTask() {
    void onMutate(
      task.id,
      async () => (await requestJson<{ task: TaskView }>(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ completed: false }) })).task,
      (current) => ({ ...current, status: "open", completedAt: null, activeTimerStartedAt: null }),
    );
  }

  async function openCompletion() {
    if (preparingCompletion) return;
    if (running) {
      setPreparingCompletion(true);
      const stopped = await onMutate(
        task.id,
        async () => (await requestJson<{ task: TaskView }>(`/api/tasks/${task.id}/timer`, { method: "POST", body: JSON.stringify({ action: "stop" }) })).task,
        (current) => ({ ...current, trackedSeconds: seconds, activeTimerStartedAt: null, status: "in_progress" }),
      );
      setPreparingCompletion(false);
      if (!stopped) return;
    }
    void ensureSuggestions().catch(() => { /* A conclusão continua disponível mesmo se a IA estiver indisponível. */ });
    setCompletionInput(task.completionSummary ?? "");
    setCompletionOpen(true);
  }

  async function completeTask(event: React.FormEvent) {
    event.preventDefault();
    const completionSummary = completionInput.trim();
    if (completionSummary.length < 10 || completing || loadingSuggestions || completionSpeech.listening) return;
    setCompleting(true);
    const completedAt = new Date().toISOString();
    const completed = await onMutate(
      task.id,
      async () => (await requestJson<{ task: TaskView }>(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: true, completionSummary }),
      })).task,
      (current) => {
        const actualSeconds = current.manualDurationSeconds ?? current.trackedSeconds;
        const efficiency = calculateEfficiencyScore(current.basePoints, current.estimatedDurationSeconds, actualSeconds);
        return {
          ...current,
          completionSummary,
          completionRationale: "A execução seguiu o escopo esperado; o Jarvis não identificou mérito técnico adicional no modo de teste.",
          efficiencyAdjustment: efficiency.adjustment,
          executionAdjustment: 0,
          points: efficiency.finalPoints,
          status: "completed",
          completedAt,
          activeTimerStartedAt: null,
        };
      },
      { optimistic: false },
    );
    setCompleting(false);
    if (completed) {
      completionSpeech.cancel();
      setCompletionOpen(false);
    }
  }

  function closeCompletion() {
    if (completing) return;
    completionSpeech.cancel();
    setCompletionOpen(false);
  }

  async function reevaluateWithJarvis() {
    if (reevaluating || task.status !== "completed" || !task.completionSummary) return;
    setReevaluating(true);
    await onMutate(
      task.id,
      async () => (await requestJson<{ task: TaskView }>(`/api/tasks/${task.id}/reevaluate`, {
        method: "POST",
      })).task,
      (current) => ({
        ...current,
        classificationStatus: "classified",
        classificationError: null,
        completionRationale: "O Jarvis concluiu a reavaliação no modo de demonstração.",
      }),
      { optimistic: false },
    );
    setReevaluating(false);
  }

  function toggleTimer() {
    const action = running ? "stop" : "start";
    void onMutate(
      task.id,
      async () => (await requestJson<{ task: TaskView }>(`/api/tasks/${task.id}/timer`, { method: "POST", body: JSON.stringify({ action }) })).task,
      (current) => running
        ? { ...current, trackedSeconds: seconds, activeTimerStartedAt: null, status: "in_progress" }
        : { ...current, activeTimerStartedAt: new Date().toISOString(), manualDurationSeconds: null, status: "in_progress" },
    );
  }

  function saveTime(event: React.FormEvent) {
    event.preventDefault();
    try {
      const durationSeconds = parseDuration(timeInput);
      void onMutate(
        task.id,
        async () => (await requestJson<{ task: TaskView }>(`/api/tasks/${task.id}/time`, { method: "PATCH", body: JSON.stringify({ durationSeconds }) })).task,
        (current) => ({ ...current, manualDurationSeconds: durationSeconds }),
      );
      setEditingTime(false);
    } catch { /* Field validity message handles the format. */ }
  }

  function saveDescription(event: React.FormEvent) {
    event.preventDefault();
    const description = descriptionInput.trim() || null;
    void onMutate(
      task.id,
      async () => (await requestJson<{ task: TaskView }>(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ description }),
      })).task,
      (current) => ({ ...current, description }),
    );
    setEditingDescription(false);
  }

  function saveDueAt(event: React.FormEvent) {
    event.preventDefault();
    if (!isFutureDeadline(dueAtInput)) return;
    const dueAt = deadlineInputToIso(dueAtInput);
    void onMutate(
      task.id,
      async () => (await requestJson<{ task: TaskView }>(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ dueAt }),
      })).task,
      (current) => ({ ...current, dueAt }),
    );
    setEditingDueAt(false);
  }

  function saveClient(event: React.FormEvent) {
    event.preventDefault();
    const client = clients.find((item) => item.id === clientIdInput);
    if (!client) return;
    void onMutate(
      task.id,
      async () => (await requestJson<{ task: TaskView }>(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ clientId: client.id }),
      })).task,
      (current) => ({
        ...current,
        clientId: client.id,
        clientName: client.name,
        clientColor: client.color,
      }),
    );
    setEditingClient(false);
  }

  async function deleteTask() {
    if (!onRemove || running) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await onRemove(task.id);
    } catch {
      setConfirmingDelete(false);
      setDeleting(false);
    }
  }

  const suggestionCount = suggestions?.length ?? 0;
  const completedSuggestionCount = suggestions?.filter((item) => item.status === "completed").length ?? 0;
  const availableSuggestionBonus = suggestions?.reduce((total, item) => total + item.rewardPercentage, 0) ?? 0;
  const confirmedSuggestionBonus = suggestions?.reduce(
    (total, item) => total + (done
      ? item.verificationStatus === "verified" ? item.rewardPercentage : 0
      : item.status === "completed" ? item.rewardPercentage : 0),
    0,
  ) ?? 0;

  return (
    <article className={`task-row ${done ? "is-done" : ""}`}>
      <button className="check-button" onClick={done ? reopenTask : () => void openCompletion()} disabled={preparingCompletion} aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}>{preparingCompletion ? <LoaderCircle className="spin" /> : done && <Check />}</button>
      <div className="task-main">
        <h3>{task.title}</h3>
        {editingDescription ? (
          <form className="task-description-editor" onSubmit={saveDescription}>
            <textarea autoFocus value={descriptionInput} onChange={(event) => setDescriptionInput(event.target.value)} maxLength={4000} rows={2} aria-label={`Descrição de ${task.title}`} />
            <button className="inline-edit-action confirm" aria-label="Salvar descrição"><Check /></button>
            <button className="inline-edit-action cancel" type="button" aria-label="Cancelar edição da descrição" onClick={() => { setDescriptionInput(task.description ?? ""); setEditingDescription(false); }}><X /></button>
          </form>
        ) : (
          <button className={`task-description ${task.description ? "has-description" : ""}`} onClick={() => setEditingDescription(true)} title="Editar descrição e observações">
            {task.description ? <span>{task.description}</span> : <span>Adicionar observação</span>}<Pencil />
          </button>
        )}
        {done && task.completionSummary && (
          <div className="completion-report">
            <Sparkles />
            <div>
              <strong>Relato de conclusão</strong>
              <p>{task.completionSummary}</p>
              {task.completionRationale && <small>Jarvis: {task.completionRationale}</small>}
              {(task.classificationStatus === "failed" || task.classificationStatus === "pending") && task.status === "completed" && (
                <div className="completion-evaluation-retry">
                  <small className="completion-evaluation-failed">
                    {reevaluating
                      ? "O Jarvis está reavaliando esta entrega..."
                      : task.classificationStatus === "failed"
                        ? task.classificationError?.title ?? "A avaliação do Jarvis não foi concluída."
                        : "A avaliação do Jarvis está pendente."}
                  </small>
                  <button type="button" onClick={() => void reevaluateWithJarvis()} disabled={reevaluating}>
                    {reevaluating ? <LoaderCircle className="spin" /> : <RefreshCw />}
                    {reevaluating ? "Reavaliando..." : "Reavaliar com Jarvis"}
                  </button>
                </div>
              )}
              {task.classificationStatus === "failed" && task.classificationError && !reevaluating && (
                <JarvisErrorDiagnostic diagnostic={task.classificationError} />
              )}
            </div>
          </div>
        )}
        <div className="task-meta">
          {!done && editingClient ? (
            <form className="task-client-editor" onSubmit={saveClient}>
              <i style={{ background: clients.find((item) => item.id === clientIdInput)?.color ?? task.clientColor }} />
              <select autoFocus aria-label={`Novo cliente de ${task.title}`} value={clientIdInput} onChange={(event) => setClientIdInput(event.target.value)}>
                {clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}
              </select>
              <ChevronDown />
              <button className="inline-edit-action confirm" aria-label="Salvar cliente" disabled={!clients.some((client) => client.id === clientIdInput)}><Check /></button>
              <button className="inline-edit-action cancel" type="button" aria-label="Cancelar edição do cliente" onClick={() => { setClientIdInput(task.clientId); setEditingClient(false); }}><X /></button>
            </form>
          ) : (
            <button
              className="client-tag"
              disabled={done}
              onClick={() => { setClientIdInput(task.clientId); setEditingClient(true); }}
              aria-label={done ? undefined : `Editar cliente de ${task.title}`}
              title={done ? undefined : "Editar cliente"}
            ><i style={{ background: task.clientColor }} />{task.clientName}{!done && <Pencil />}</button>
          )}
          <span className={`level-badge level-${task.complexityLevel}`}>Nível {task.complexityLevel}</span>
          <span className="points">{task.points} pts</span>
          {task.efficiencyAdjustment !== 0 && <span className={`efficiency-badge ${task.efficiencyAdjustment > 0 ? "positive" : "negative"}`} title="Ajuste por eficiência de tempo">{task.efficiencyAdjustment > 0 ? "+" : ""}{task.efficiencyAdjustment} tempo</span>}
          {task.executionAdjustment !== 0 && <span className={`efficiency-badge ${task.executionAdjustment > 0 ? "positive" : "negative"}`} title="Ajuste de execução avaliado pelo Jarvis">{task.executionAdjustment > 0 ? "+" : ""}{task.executionAdjustment} execução</span>}
          <span className="sla-label">Tempo previsto {formatDuration(task.estimatedDurationSeconds)}</span>
          {!done && editingDueAt ? (
            <form className="due-editor" onSubmit={saveDueAt}>
              <CalendarClock />
              <input autoFocus aria-label={`Novo prazo de ${task.title}`} type="datetime-local" required min={toDateTimeLocalValue(new Date())} value={dueAtInput} onChange={(event) => setDueAtInput(event.target.value)} />
              <button className="inline-edit-action confirm" aria-label="Salvar prazo" disabled={!isFutureDeadline(dueAtInput)}><Check /></button>
              <button className="inline-edit-action cancel" type="button" aria-label="Cancelar edição do prazo" onClick={() => setEditingDueAt(false)}><X /></button>
            </form>
          ) : task.dueAt ? (
            <button
              className={`due-label ${!done && new Date(task.dueAt).getTime() < now ? "overdue" : ""}`}
              disabled={done}
              onClick={() => { setDueAtInput(toDateTimeLocalValue(new Date(task.dueAt!))); setEditingDueAt(true); }}
              aria-label={done ? undefined : `Editar prazo de ${task.title}`}
              title={done ? undefined : "Editar prazo e recalcular a prioridade"}
            ><CalendarClock />Prazo {formatDeadline(task.dueAt, settings.timezone)}{!done && <Pencil />}</button>
          ) : null}
        </div>
      </div>
      <div className="task-value"><span>{done ? formatCurrency(calculateAmountCents(task.points, settings.pointValueCents)) : "Estimado"}</span><strong>{task.points} × {formatCurrency(settings.pointValueCents)}</strong></div>
      <div className="timer-control">
        {editingTime ? (
          <form onSubmit={saveTime} className="time-editor"><input autoFocus value={timeInput} pattern="\d{1,4}:[0-5]\d:[0-5]\d" onChange={(event) => setTimeInput(event.target.value)} /><button className="inline-edit-action confirm" aria-label="Salvar tempo"><Check /></button><button className="inline-edit-action cancel" type="button" aria-label="Cancelar edição do tempo" onClick={() => setEditingTime(false)}><X /></button></form>
        ) : (
          <button className="time-display" disabled={running} onClick={() => { setTimeInput(formatDuration(seconds)); setEditingTime(true); }} title={running ? "Pare o cronômetro antes de editar" : "Editar tempo"}><Clock3 />{formatDuration(seconds)}</button>
        )}
        {!done && <button className={`play-button ${running ? "running" : ""}`} onClick={toggleTimer} aria-label={running ? "Parar cronômetro" : "Iniciar cronômetro"}>{running ? <Pause /> : <Play />}</button>}
        {!done && onRemove && <button className={`delete-task-button ${confirmingDelete ? "confirming" : ""}`} onClick={() => void deleteTask()} onBlur={() => !deleting && setConfirmingDelete(false)} disabled={running || deleting} aria-label={confirmingDelete ? `Confirmar exclusão de ${task.title}` : `Excluir ${task.title}`} title={running ? "Pare o cronômetro antes de excluir" : "Excluir tarefa"}>{deleting ? <LoaderCircle className="spin" /> : confirmingDelete ? <span>Excluir</span> : <Trash2 />}</button>}
      </div>
      <div className="task-suggestions-area">
        <button type="button" className="suggestions-toggle" onClick={() => void toggleSuggestions()} aria-expanded={suggestionsOpen}>
          <span><Sparkles /> Sugestões do Jarvis</span>
          {suggestionCount > 0 && <small>{completedSuggestionCount}/{suggestionCount} realizados · +{confirmedSuggestionBonus}% confirmado · +{availableSuggestionBonus}% disponível</small>}
          {loadingSuggestions ? <LoaderCircle className="spin" /> : <ChevronDown />}
        </button>
        {suggestionsOpen && (
          <div className="suggestions-panel">
            {loadingSuggestions && <p className="suggestions-state"><LoaderCircle className="spin" /> Jarvis está preparando sugestões para esta demanda...</p>}
            {suggestionsError && <p className="suggestions-error" role="alert">{suggestionsError}</p>}
            {suggestions && suggestions.length > 0 && (
              <TaskSuggestionsChecklist
                suggestions={suggestions}
                done={done}
                savingId={savingSuggestionId}
                evidenceDrafts={evidenceDrafts}
                onEvidenceChange={(id, value) => setEvidenceDrafts((current) => ({ ...current, [id]: value }))}
                onUpdate={(suggestion, status, evidence) => void updateSuggestion(suggestion, status, evidence)}
              />
            )}
            {!loadingSuggestions && suggestions && suggestions.length === 0 && <p className="suggestions-state">Esta tarefa foi concluída sem um checklist de sugestões.</p>}
          </div>
        )}
      </div>
      {completionOpen && createPortal((
        <div className="completion-modal-backdrop" onMouseDown={closeCompletion}>
          <section className="completion-modal" role="dialog" aria-modal="true" aria-labelledby={`completion-title-${task.id}`} onMouseDown={(event) => event.stopPropagation()}>
            <div className="completion-modal-head">
              <span><Sparkles /></span>
              <div><p>FECHAMENTO ASSISTIDO</p><h2 id={`completion-title-${task.id}`}>Como foi a execução?</h2></div>
              <button type="button" onClick={closeCompletion} disabled={completing} aria-label="Fechar relato de conclusão"><X /></button>
            </div>
            <p className="completion-task-title">{task.title}</p>
            <div className="completion-context">
              <span><Clock3 /> Real {formatDuration(seconds)}</span>
              <span>Tempo previsto {formatDuration(task.estimatedDurationSeconds)}</span>
              <span>{task.basePoints} pontos-base</span>
            </div>
            {suggestions && suggestions.length > 0 && (
              <div className="completion-checklist">
                <div className="completion-checklist-heading">
                  <div><strong>Revise o checklist</strong><small>O Jarvis verificará os itens usando seu relato e as comprovações.</small></div>
                  <span>{completedSuggestionCount}/{suggestionCount} realizados</span>
                </div>
                <TaskSuggestionsChecklist
                  suggestions={suggestions}
                  done={false}
                  compact
                  savingId={savingSuggestionId}
                  evidenceDrafts={evidenceDrafts}
                  onEvidenceChange={(id, value) => setEvidenceDrafts((current) => ({ ...current, [id]: value }))}
                  onUpdate={(suggestion, status, evidence) => void updateSuggestion(suggestion, status, evidence)}
                />
              </div>
            )}
            {suggestionsError && <p className="suggestions-error" role="alert">{suggestionsError}</p>}
            <form onSubmit={completeTask}>
              <label htmlFor={`completion-summary-${task.id}`}>Conte livremente como foi a entrega</label>
              <div className="completion-input-wrap">
                <textarea
                  id={`completion-summary-${task.id}`}
                  autoFocus
                  required
                  minLength={10}
                  maxLength={4000}
                  rows={6}
                  readOnly={completionSpeech.listening}
                  value={completionInput}
                  onChange={(event) => setCompletionInput(event.target.value)}
                  placeholder="Digite ou use o microfone. Conte tudo do seu jeito: o que fez, problemas, soluções, pendências e como validou..."
                />
                <button
                  type="button"
                  className={`completion-dictation-button ${completionSpeech.listening ? "listening" : ""}`}
                  onClick={completionSpeech.toggle}
                  disabled={completing || !completionSpeech.supported}
                  aria-label={completionSpeech.listening ? "Parar ditado da entrega" : "Ditar relato da entrega"}
                  aria-pressed={completionSpeech.listening}
                  title={completionSpeech.supported ? "Ditar relato em português" : "Ditado não disponível neste navegador"}
                >
                  <Mic />
                </button>
              </div>
              <div className={`completion-speech-status ${completionSpeech.error ? "error" : completionSpeech.listening ? "listening" : ""}`} role={completionSpeech.error ? "alert" : "status"}>
                {completionSpeech.error ?? (completionSpeech.listening ? "Ouvindo... fale naturalmente e toque novamente para parar." : "Você pode ditar e revisar o texto antes de concluir.")}
              </div>
              <div className="completion-hint"><Sparkles /><span>O Jarvis organizará seu relato, conferirá o checklist e avaliará autoria, qualidade, resultado e correções necessárias. Usar inteligência artificial ou automação não reduz pontos quando você conduz, revisa e valida a entrega.</span></div>
              <div className="completion-actions">
                <button type="button" onClick={closeCompletion} disabled={completing}>Cancelar</button>
                <button type="submit" disabled={completing || loadingSuggestions || completionSpeech.listening || completionInput.trim().length < 10}>{completing || loadingSuggestions ? <LoaderCircle className="spin" /> : <Sparkles />} {completing ? "Jarvis está resumindo..." : loadingSuggestions ? "Preparando checklist..." : "Resumir e concluir"}</button>
              </div>
            </form>
          </section>
        </div>
      ), document.body)}
    </article>
  );
}

function AgencyView({ tasks, settings, demoMode, onMutateTask }: { tasks: TaskView[]; settings: WorkspaceSettings; demoMode: boolean; onMutateTask: TaskMutator }) {
  const completed = tasks.filter((task) => task.completedAt);
  const period = billingWindow();
  const report = generateBillingReport({
    tasks: completed.map((task) => ({ id: task.id, title: task.title, clientId: task.clientId, clientName: task.clientName, completedAt: task.completedAt!, points: task.points, trackedSeconds: task.trackedSeconds, manualDurationSeconds: task.manualDurationSeconds })),
    periodStart: period.start.toISOString(), periodEnd: period.end.toISOString(), pointValueCents: settings.pointValueCents,
  });

  function downloadCsv() {
    const blob = new Blob([reportToCsv(report)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `faturamento-${report.periodStart.slice(0, 10)}.csv`; anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="content-wrap agency-view">
      <div className="page-heading report-heading">
        <div><p className="eyebrow">PAINEL DA AGÊNCIA</p><h1>Faturamento</h1><p>{period.start.toLocaleDateString("pt-BR")} — {period.end.toLocaleDateString("pt-BR")}</p></div>
        <div className="report-actions"><button onClick={downloadCsv}><Download /> CSV</button><button className="primary" onClick={() => window.print()}><Download /> Salvar PDF</button></div>
      </div>
      <div className="metric-grid">
        <Metric icon={<CircleDollarSign />} label="Valor do ciclo" value={formatCurrency(report.totalAmountCents)} />
        <Metric icon={<Sparkles />} label="Pontos entregues" value={`${report.totalPoints} pts`} />
        <Metric icon={<Clock3 />} label="Tempo registrado" value={formatDuration(report.totalDurationSeconds)} />
      </div>
      <section className="report-card">
        <div className="report-card-title"><div><p className="eyebrow">DETALHAMENTO</p><h2>Entregas por cliente</h2></div><span>{report.clients.length} clientes</span></div>
        {report.clients.map((client) => (
          <div className="client-report" key={client.clientId}>
            <div className="client-report-head"><strong>{client.clientName}</strong><span>{client.totalPoints} pts · {formatCurrency(client.totalAmountCents)}</span></div>
            {client.tasks.map((item) => {
              const source = tasks.find((task) => task.id === item.id)!;
              return <AgencyTaskReportRow key={item.id} item={item} source={source} settings={settings} demoMode={demoMode} onMutateTask={onMutateTask} />;
            })}
          </div>
        ))}
        {report.clients.length === 0 && <EmptyState label="Nenhuma tarefa concluída neste ciclo." />}
      </section>
    </div>
  );
}

type AgencyReportItem = ReturnType<typeof generateBillingReport>["clients"][number]["tasks"][number];

function pointsLabel(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value} ${Math.abs(value) === 1 ? "ponto" : "pontos"}`;
}

function timeAdjustmentExplanation(task: TaskView, actualDurationSeconds: number): string {
  if (task.estimatedDurationSeconds <= 0) return "SLA indisponível para comparar a eficiência de tempo.";
  const usagePercentage = Math.round((actualDurationSeconds / task.estimatedDurationSeconds) * 100);
  const comparison = `Tempo real de ${formatDuration(actualDurationSeconds)}, equivalente a ${usagePercentage}% do SLA de ${formatDuration(task.estimatedDurationSeconds)}.`;
  if (task.efficiencyAdjustment > 0) return `${comparison} O prazo foi significativamente antecipado e gerou ${pointsLabel(task.efficiencyAdjustment)}.`;
  if (task.efficiencyAdjustment < 0) return `${comparison} O SLA foi ultrapassado e gerou ${pointsLabel(task.efficiencyAdjustment)}.`;
  return `${comparison} A execução ficou na faixa esperada, sem ajuste de tempo.`;
}

function executionAdjustmentExplanation(task: TaskView): string {
  if (task.completionRationale) return task.completionRationale;
  if (task.classificationStatus === "pending") return "A avaliação da entrega ainda está pendente no Jarvis.";
  if (task.classificationStatus === "failed") return "O Jarvis não conseguiu concluir a avaliação desta entrega.";
  return task.executionAdjustment === 0
    ? "O Jarvis não identificou evidências para bônus ou penalidade de execução."
    : "A justificativa detalhada do ajuste não está disponível.";
}

function AgencyTaskReportRow({
  item,
  source,
  settings,
  demoMode,
  onMutateTask,
}: {
  item: AgencyReportItem;
  source: TaskView;
  settings: WorkspaceSettings;
  demoMode: boolean;
  onMutateTask: TaskMutator;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasPositiveBonus = source.efficiencyAdjustment > 0 || source.executionAdjustment > 0;
  const hasPenalty = source.efficiencyAdjustment < 0 || source.executionAdjustment < 0;

  return (
    <div className={`agency-task-report ${detailsOpen ? "details-open" : ""}`}>
      <div className="report-line">
        <span className={`approval-dot ${source.status === "approved" ? "approved" : ""}`}><Check /></span>
        <div><strong>{item.title}</strong><span>{new Date(item.completedAt).toLocaleDateString("pt-BR")} · {formatDuration(item.durationSeconds)}</span></div>
        <em>{item.points} pts</em>
        <b>{formatCurrency(item.amountCents)}</b>
        {source.status === "approved"
          ? <span className="approved-label">Aprovada</span>
          : <button className="approve-button" onClick={() => void onMutateTask(source.id, async () => (await requestJson<{ task: TaskView }>(`/api/tasks/${source.id}/approval`, { method: "POST" })).task, (task) => ({ ...task, status: "approved" }))}>{demoMode ? "Aprovar" : "Aprovar"}</button>}
        <button
          type="button"
          className="report-detail-toggle"
          onClick={() => setDetailsOpen((current) => !current)}
          aria-expanded={detailsOpen}
          aria-label={`${detailsOpen ? "Ocultar" : "Ver"} detalhes de ${item.title}`}
        ><span>Detalhes</span><ChevronDown /></button>
      </div>
      <div className="report-task-details" hidden={!detailsOpen}>
        <div className="report-score-grid">
          <div className="report-score-step">
            <span>Complexidade</span>
            <strong>Nível {source.complexityLevel}</strong>
            <p>{source.basePoints} pontos-base atribuídos pelo Jarvis.</p>
          </div>
          <div className={`report-score-step ${source.efficiencyAdjustment > 0 ? "positive" : source.efficiencyAdjustment < 0 ? "negative" : ""}`}>
            <span>Ajuste de tempo</span>
            <strong>{pointsLabel(source.efficiencyAdjustment)}</strong>
            <p>{timeAdjustmentExplanation(source, item.durationSeconds)}</p>
          </div>
          <div className={`report-score-step ${source.executionAdjustment > 0 ? "positive" : source.executionAdjustment < 0 ? "negative" : ""}`}>
            <span>Avaliação da entrega</span>
            <strong>{pointsLabel(source.executionAdjustment)}</strong>
            <p>{executionAdjustmentExplanation(source)}</p>
          </div>
          <div className="report-score-total">
            <span>Pontuação final</span>
            <strong>{source.points} pts</strong>
            <p>{source.basePoints} {source.efficiencyAdjustment >= 0 ? "+" : "−"} {Math.abs(source.efficiencyAdjustment)} {source.executionAdjustment >= 0 ? "+" : "−"} {Math.abs(source.executionAdjustment)} = {source.points}</p>
            <small>{hasPenalty ? "A entrega recebeu penalidade." : hasPositiveBonus ? "A entrega recebeu bônus." : "Sem bônus ou penalidades."} · {formatCurrency(source.points * settings.pointValueCents)}</small>
          </div>
        </div>
        {source.completionSummary && (
          <div className="report-completion-summary">
            <Sparkles />
            <div><span>Resumo da entrega</span><p>{source.completionSummary}</p></div>
          </div>
        )}
      </div>
    </div>
  );
}

const CLIENT_COLORS = ["#007CFF", "#AF52DE", "#FF9F0A", "#00C864", "#FF453A", "#5AC8FA"];

function ClientManagerPanel({
  clients,
  tasks,
  onClose,
  onCreate,
  onUpdate,
  onRemove,
  onNotice,
}: {
  clients: ClientSummary[];
  tasks: TaskView[];
  onClose: () => void;
  onCreate: (input: { name: string; color: string }) => Promise<ClientSummary>;
  onUpdate: (id: string, input: { name: string; color: string }) => Promise<ClientSummary>;
  onRemove: (id: string) => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("#007CFF");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setName("");
    setColor("#007CFF");
    setEditingId(null);
  }

  function startEditing(client: ClientSummary) {
    setName(client.name);
    setColor(client.color);
    setEditingId(client.id);
    setConfirmingId(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const cleanName = name.trim();
    if (cleanName.length < 2) return;
    setBusy(true);
    try {
      if (editingId) {
        await onUpdate(editingId, { name: cleanName, color });
        onNotice("Cliente atualizado.");
      } else {
        await onCreate({ name: cleanName, color });
        onNotice("Cliente adicionado.");
      }
      resetForm();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Não foi possível salvar o cliente.");
    } finally {
      setBusy(false);
    }
  }

  async function removeClient(id: string) {
    if (confirmingId !== id) {
      setConfirmingId(id);
      return;
    }
    setBusy(true);
    try {
      await onRemove(id);
      if (editingId === id) resetForm();
      setConfirmingId(null);
      onNotice("Cliente removido. O histórico foi preservado.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Não foi possível remover o cliente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside className="settings-drawer clients-drawer" onMouseDown={(event) => event.stopPropagation()} aria-label="Gerenciar clientes">
        <div className="drawer-head">
          <div><p className="eyebrow">ORGANIZAÇÃO</p><h2>Clientes</h2><span className="drawer-description">Adicione, edite ou arquive clientes da agência.</span></div>
          <button onClick={onClose} aria-label="Fechar clientes"><X /></button>
        </div>

        <form className="client-form" onSubmit={submit}>
          <div className="client-form-title"><UserRoundPlus /><strong>{editingId ? "Editar cliente" : "Novo cliente"}</strong>{editingId && <button type="button" onClick={resetForm}>Cancelar</button>}</div>
          <label htmlFor="client-name">Nome do cliente</label>
          <input id="client-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Make One" minLength={2} maxLength={120} required />
          <fieldset>
            <legend>Cor de identificação</legend>
            <div className="color-options">
              {CLIENT_COLORS.map((option) => <button type="button" key={option} className={color.toLowerCase() === option.toLowerCase() ? "selected" : ""} style={{ background: option }} onClick={() => setColor(option)} aria-label={`Usar cor ${option}`} />)}
              <label className="custom-color" title="Escolher outra cor"><input type="color" value={color} onChange={(event) => setColor(event.target.value.toUpperCase())} aria-label="Escolher cor personalizada" /><span>+</span></label>
            </div>
          </fieldset>
          <button className="save-settings" disabled={busy || name.trim().length < 2}>{busy ? <LoaderCircle className="spin" /> : editingId ? "Salvar alterações" : "Adicionar cliente"}</button>
        </form>

        <div className="client-manager-list">
          <div className="client-list-heading"><strong>Clientes ativos</strong><span>{clients.length}</span></div>
          {clients.map((client) => {
            const taskCount = tasks.filter((task) => task.clientId === client.id).length;
            const confirming = confirmingId === client.id;
            return (
              <div className="client-manager-row" key={client.id}>
                <span className="client-manager-color" style={{ background: client.color }} />
                <div><strong>{client.name}</strong><span>{taskCount} {taskCount === 1 ? "tarefa" : "tarefas"}</span></div>
                <button onClick={() => startEditing(client)} aria-label={`Editar ${client.name}`} disabled={busy}><Pencil /></button>
                <button className={confirming ? "confirm-remove" : ""} onClick={() => void removeClient(client.id)} aria-label={confirming ? `Confirmar remoção de ${client.name}` : `Remover ${client.name}`} disabled={busy}>{confirming ? <span>Confirmar</span> : <Trash2 />}</button>
              </div>
            );
          })}
          {clients.length === 0 && <div className="client-empty"><Users /><p>Nenhum cliente ativo.</p></div>}
        </div>
        <p className="archive-note">Clientes removidos são arquivados. Tarefas e relatórios anteriores permanecem intactos.</p>
      </aside>
    </div>
  );
}

function SettingsPanel({ settings, demoMode, onClose, onSave }: { settings: WorkspaceSettings; demoMode: boolean; onClose: () => void; onSave: (settings: WorkspaceSettings) => void }) {
  const [value, setValue] = useState((settings.pointValueCents / 100).toFixed(2).replace(".", ","));
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const pointValueCents = Math.round(Number(value.replace(",", ".")) * 100);
    if (!Number.isInteger(pointValueCents) || pointValueCents < 1) return;
    setSaving(true);
    try {
      if (!demoMode) await requestJson("/api/settings", { method: "PATCH", body: JSON.stringify({ pointValueCents }) });
      onSave({ ...settings, pointValueCents });
    } finally { setSaving(false); }
  }
  return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="settings-drawer" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><p className="eyebrow">PREFERÊNCIAS</p><h2>Ajustes</h2></div><button onClick={onClose}><X /></button></div><form onSubmit={submit}><label>Moeda<span>Usada em todos os relatórios.</span></label><div className="static-field">Real brasileiro <b>BRL</b></div><label htmlFor="point-value">Valor de 1 ponto<span>Alterações afetam novos fechamentos.</span></label><div className="money-input"><span>R$</span><input id="point-value" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} /></div><div className="formula-preview"><Sparkles /><div><span>Exemplo com 25 pontos</span><strong>{formatCurrency(25 * Math.round(Number(value.replace(",", ".")) * 100 || 0))}</strong></div></div><button className="save-settings" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : "Salvar ajustes"}</button></form></aside></div>;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="metric-card"><span>{icon}</span><div><p>{label}</p><strong>{value}</strong></div></div>; }
function EmptyState({ label = "Tudo em dia. Adicione uma nova demanda acima." }: { label?: string }) { return <div className="empty-state"><Check /><p>{label}</p></div>; }
function roleLabel(role: AppRole) { return role === "developer" ? "Desenvolvedor" : "Agência"; }
