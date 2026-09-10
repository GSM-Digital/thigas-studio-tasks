"use client";

import {
  BriefcaseBusiness,
  CalendarClock,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Download,
  LayoutDashboard,
  ListTodo,
  LoaderCircle,
  Moon,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
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
import {
  createDefaultDeadline,
  deadlineInputToIso,
  formatDeadline,
  isFutureDeadline,
  toDateTimeLocalValue,
} from "@/lib/domain/deadline";
import { calculateAmountCents, formatCurrency } from "@/lib/domain/points";
import { effectiveDuration, formatDuration, parseDuration } from "@/lib/domain/time";
import { generateBillingReport, reportToCsv } from "@/lib/reports/generate";
import type {
  AppRole,
  ClientSummary,
  TaskView,
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

interface JarvisUiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível concluir a ação.");
  return body;
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

  async function mutateTask(
    id: string,
    action: () => Promise<TaskView>,
    fallback: (task: TaskView) => TaskView,
  ) {
    const previous = tasks;
    setTasks((current) => current.map((task) => (task.id === id ? fallback(task) : task)));
    if (demoMode) return;
    try {
      const updated = await action();
      setTasks((current) => current.map((task) => (task.id === id ? updated : task)));
    } catch (error) {
      setTasks(previous);
      showNotice(error instanceof Error ? error.message : "Ação não concluída.");
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
          onTaskCreated={(task) => {
            setTasks((current) => [task, ...current]);
            showNotice("Demanda adicionada pelo Jarvis.");
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
  onTaskCreated: (task: TaskView) => void;
}) {
  const [messages, setMessages] = useState<JarvisUiMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Olá! Conte a demanda, o cliente, a estimativa e o prazo de entrega. Se faltar algo, eu pergunto.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (!content || sending) return;

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
      const result = await requestJson<{ message: string; task: TaskView | null }>(
        "/api/jarvis/chat",
        {
          method: "POST",
          body: JSON.stringify({
            messages: nextMessages.slice(-12).map(({ role, content: text }) => ({ role, content: text })),
          }),
        },
      );
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: result.message },
      ]);
      if (result.task) onTaskCreated(result.task);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: error instanceof Error ? error.message : "Não consegui processar a mensagem. Tente novamente.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside className="jarvis-drawer" onMouseDown={(event) => event.stopPropagation()} aria-label="Conversa com Jarvis">
        <div className="jarvis-head">
          <div className="jarvis-identity"><span><Sparkles /></span><div><strong>Jarvis</strong><small>Analista de demandas</small></div></div>
          <button onClick={onClose} aria-label="Fechar Jarvis"><X /></button>
        </div>
        <div className="jarvis-messages" aria-live="polite">
          {messages.map((message) => (
            <div className={`jarvis-message ${message.role}`} key={message.id}>
              {message.role === "assistant" && <span className="jarvis-avatar"><Sparkles /></span>}
              <p>{message.content}</p>
            </div>
          ))}
          {sending && <div className="jarvis-message assistant"><span className="jarvis-avatar"><Sparkles /></span><p className="jarvis-thinking"><i /><i /><i /></p></div>}
          <div ref={messagesEnd} />
        </div>
        <form className="jarvis-composer" onSubmit={sendMessage}>
          <textarea
            aria-label="Mensagem para o Jarvis"
            value={input}
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
          <div><span>Enter para enviar · Shift + Enter para quebrar linha</span><button type="submit" disabled={sending || !input.trim()} aria-label="Enviar mensagem">{sending ? <LoaderCircle className="spin" /> : <Send />}</button></div>
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
  onNotice,
}: {
  tasks: TaskView[];
  allTasks: TaskView[];
  clients: ClientSummary[];
  settings: WorkspaceSettings;
  demoMode: boolean;
  onTasksChange: React.Dispatch<React.SetStateAction<TaskView[]>>;
  onMutateTask: (id: string, action: () => Promise<TaskView>, fallback: (task: TaskView) => TaskView) => Promise<void>;
  onRemoveTask: (id: string) => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [estimatedHours, setEstimatedHours] = useState("8");
  const [dueAt, setDueAt] = useState(createDefaultDeadline);
  const [adding, setAdding] = useState(false);
  const openTasks = tasks.filter((task) => task.status !== "completed" && task.status !== "approved");
  const completedTasks = tasks.filter((task) => task.status === "completed" || task.status === "approved");
  const todayCompleted = allTasks.filter((task) => task.completedAt?.slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
  const effectiveClientId = clients.some((client) => client.id === clientId)
    ? clientId
    : clients[0]?.id ?? "";

  async function addTask(event: React.FormEvent) {
    event.preventDefault();
    const cleanTitle = title.trim();
    const estimatedDurationSeconds = Math.round(Number(estimatedHours) * 3600);
    if (!cleanTitle || !effectiveClientId || !Number.isInteger(estimatedDurationSeconds) || estimatedDurationSeconds <= 0) return;
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
        created = {
          id: crypto.randomUUID(), title: cleanTitle, clientId: effectiveClientId, clientName: client.name,
          clientColor: client.color, status: "open", complexityLevel: 2,
          basePoints: 8, efficiencyAdjustment: 0, points: 8, estimatedDurationSeconds,
          dueAt: dueAtIso, completedAt: null, activeTimerStartedAt: null, trackedSeconds: 0,
          manualDurationSeconds: null, classificationStatus: "classified",
        };
      } else {
        const result = await requestJson<{ task: TaskView }>("/api/tasks", {
          method: "POST", body: JSON.stringify({ title: cleanTitle, clientId: effectiveClientId, estimatedDurationSeconds, dueAt: dueAtIso }),
        });
        created = result.task;
      }
      onTasksChange((current) => [created, ...current]);
      setTitle("");
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
        <div><p className="eyebrow">MEU TRABALHO</p><h1>Hoje</h1><p>{new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</p></div>
        <div className="day-score"><Check /><div><strong>{todayCompleted}</strong><span>concluídas hoje</span></div></div>
      </div>

      <form className="quick-add" onSubmit={addTask}>
        <span className="add-circle"><Plus /></span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Adicionar nova demanda..." aria-label="Título da nova tarefa" maxLength={240} />
        <div className="client-select-wrap">
          <span style={{ background: clients.find((client) => client.id === effectiveClientId)?.color }} />
          <select aria-label="Cliente" value={effectiveClientId} onChange={(event) => setClientId(event.target.value)}>
            {clients.length === 0 && <option value="">Cadastre um cliente</option>}
            {clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}
          </select><ChevronDown />
        </div>
        <label className="estimate-input-wrap"><Clock3 /><input aria-label="Prazo estimado em horas" type="number" min="0.25" max="99999" step="0.25" value={estimatedHours} onChange={(event) => setEstimatedHours(event.target.value)} /><span>h</span></label>
        <label className="deadline-input-wrap" title="Data e hora limite para concluir a tarefa"><CalendarClock /><input aria-label="Data e hora do prazo" type="datetime-local" required min={toDateTimeLocalValue(new Date())} value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
        <button className="add-button" type="submit" disabled={adding || !title.trim() || !effectiveClientId || Number(estimatedHours) <= 0 || !isFutureDeadline(dueAt)}>{adding ? <LoaderCircle className="spin" /> : <><Sparkles /> Adicionar</>}</button>
      </form>

      <div className="list-toolbar"><span>{openTasks.length} pendentes</span><button><SlidersHorizontal /> Filtrar</button></div>
      <div className="task-list">
        {openTasks.map((task) => <TaskRow key={task.id} task={task} settings={settings} onMutate={onMutateTask} onRemove={onRemoveTask} />)}
        {openTasks.length === 0 && <EmptyState />}
      </div>

      {completedTasks.length > 0 && (
        <details className="completed-group" open>
          <summary><ChevronDown /> Concluídas <span>{completedTasks.length}</span></summary>
          <div className="task-list completed-list">
            {completedTasks.map((task) => <TaskRow key={task.id} task={task} settings={settings} onMutate={onMutateTask} />)}
          </div>
        </details>
      )}
    </div>
  );
}

function TaskRow({ task, settings, onMutate, onRemove }: { task: TaskView; settings: WorkspaceSettings; onMutate: (id: string, action: () => Promise<TaskView>, fallback: (task: TaskView) => TaskView) => Promise<void>; onRemove?: (id: string) => Promise<void> }) {
  const [editingTime, setEditingTime] = useState(false);
  const [timeInput, setTimeInput] = useState("");
  const [now, setNow] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  function toggleDone() {
    const completed = !done;
    void onMutate(
      task.id,
      async () => (await requestJson<{ task: TaskView }>(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ completed }) })).task,
      (current) => ({ ...current, status: completed ? "completed" : "open", completedAt: completed ? new Date().toISOString() : null, activeTimerStartedAt: null }),
    );
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

  return (
    <article className={`task-row ${done ? "is-done" : ""}`}>
      <button className="check-button" onClick={toggleDone} aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}>{done && <Check />}</button>
      <div className="task-main">
        <h3>{task.title}</h3>
        <div className="task-meta"><span className="client-tag"><i style={{ background: task.clientColor }} />{task.clientName}</span><span className={`level-badge level-${task.complexityLevel}`}>Nível {task.complexityLevel}</span><span className="points">{task.points} pts</span>{task.efficiencyAdjustment !== 0 && <span className={`efficiency-badge ${task.efficiencyAdjustment > 0 ? "positive" : "negative"}`}>{task.efficiencyAdjustment > 0 ? "+" : ""}{task.efficiencyAdjustment}</span>}<span className="sla-label">SLA {formatDuration(task.estimatedDurationSeconds)}</span>{task.dueAt && <span className={`due-label ${!done && new Date(task.dueAt).getTime() < now ? "overdue" : ""}`}><CalendarClock />Prazo {formatDeadline(task.dueAt)}</span>}</div>
      </div>
      <div className="task-value"><span>{done ? formatCurrency(calculateAmountCents(task.points, settings.pointValueCents)) : "Estimado"}</span><strong>{task.points} × {formatCurrency(settings.pointValueCents)}</strong></div>
      <div className="timer-control">
        {editingTime ? (
          <form onSubmit={saveTime} className="time-editor"><input autoFocus value={timeInput} pattern="\d{1,4}:[0-5]\d:[0-5]\d" onChange={(event) => setTimeInput(event.target.value)} /><button aria-label="Salvar tempo"><Check /></button><button type="button" aria-label="Cancelar" onClick={() => setEditingTime(false)}><X /></button></form>
        ) : (
          <button className="time-display" disabled={running} onClick={() => { setTimeInput(formatDuration(seconds)); setEditingTime(true); }} title={running ? "Pare o cronômetro antes de editar" : "Editar tempo"}><Clock3 />{formatDuration(seconds)}</button>
        )}
        {!done && <button className={`play-button ${running ? "running" : ""}`} onClick={toggleTimer} aria-label={running ? "Parar cronômetro" : "Iniciar cronômetro"}>{running ? <Pause /> : <Play />}</button>}
        {!done && onRemove && <button className={`delete-task-button ${confirmingDelete ? "confirming" : ""}`} onClick={() => void deleteTask()} onBlur={() => !deleting && setConfirmingDelete(false)} disabled={running || deleting} aria-label={confirmingDelete ? `Confirmar exclusão de ${task.title}` : `Excluir ${task.title}`} title={running ? "Pare o cronômetro antes de excluir" : "Excluir tarefa"}>{deleting ? <LoaderCircle className="spin" /> : confirmingDelete ? <span>Excluir</span> : <Trash2 />}</button>}
      </div>
    </article>
  );
}

function AgencyView({ tasks, settings, demoMode, onMutateTask }: { tasks: TaskView[]; settings: WorkspaceSettings; demoMode: boolean; onMutateTask: (id: string, action: () => Promise<TaskView>, fallback: (task: TaskView) => TaskView) => Promise<void> }) {
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
              return <div className="report-line" key={item.id}><span className={`approval-dot ${source.status === "approved" ? "approved" : ""}`}><Check /></span><div><strong>{item.title}</strong><span>{new Date(item.completedAt).toLocaleDateString("pt-BR")} · {formatDuration(item.durationSeconds)}</span></div><em>{item.points} pts</em><b>{formatCurrency(item.amountCents)}</b>{source.status === "approved" ? <span className="approved-label">Aprovada</span> : <button className="approve-button" onClick={() => void onMutateTask(source.id, async () => (await requestJson<{ task: TaskView }>(`/api/tasks/${source.id}/approval`, { method: "POST" })).task, (task) => ({ ...task, status: "approved" }))}>{demoMode ? "Aprovar" : "Aprovar"}</button>}</div>;
            })}
          </div>
        ))}
        {report.clients.length === 0 && <EmptyState label="Nenhuma tarefa concluída neste ciclo." />}
      </section>
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
