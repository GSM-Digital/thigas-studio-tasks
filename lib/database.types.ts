type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type ProfileRow = {
  id: string;
  agency_id: string;
  full_name: string;
  role: "developer" | "agency";
  created_at: string;
  updated_at: string;
};

type AgencyRow = {
  id: string;
  name: string;
  currency_code: "BRL";
  point_value_cents: number;
  timezone: string;
  created_at: string;
  updated_at: string;
};

type ClientRow = {
  id: string;
  agency_id: string;
  name: string;
  color: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  id: string;
  agency_id: string;
  client_id: string;
  assignee_id: string | null;
  created_by: string;
  title: string;
  description: string | null;
  status: "open" | "in_progress" | "completed" | "approved";
  complexity_level: 1 | 2 | 3 | 4;
  base_points: number;
  efficiency_adjustment: number;
  points: number;
  estimated_duration_seconds: number;
  due_at: string | null;
  classification_status: "pending" | "classified" | "failed" | "manual";
  classification_metadata: Json;
  ai_model: string | null;
  tracked_seconds: number;
  manual_duration_seconds: number | null;
  completed_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
};

type TimeEntryRow = {
  id: string;
  agency_id: string;
  task_id: string;
  user_id: string;
  started_at: string;
  stopped_at: string | null;
  duration_seconds: number | null;
  created_at: string;
};

type BillingCycleRow = {
  id: string;
  agency_id: string;
  period_start: string;
  period_end: string;
  point_value_cents: number;
  total_points: number;
  total_amount_cents: number;
  generated_at: string;
};

type BillingItemRow = {
  id: string;
  billing_cycle_id: string;
  agency_id: string;
  client_id: string;
  task_id: string;
  points: number;
  amount_cents: number;
  duration_seconds: number;
  created_at: string;
};

type TableDef<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      agencies: TableDef<AgencyRow>;
      profiles: TableDef<ProfileRow>;
      clients: TableDef<ClientRow>;
      tasks: TableDef<TaskRow>;
      time_entries: TableDef<TimeEntryRow>;
      billing_cycles: TableDef<BillingCycleRow>;
      billing_items: TableDef<BillingItemRow>;
    };
    Views: Record<string, never>;
    Functions: {
      start_task_timer: {
        Args: { target_task_id: string };
        Returns: TimeEntryRow;
      };
      stop_task_timer: {
        Args: { target_task_id: string };
        Returns: TaskRow;
      };
      approve_task: {
        Args: { target_task_id: string };
        Returns: TaskRow;
      };
      generate_monthly_billing_cycles: {
        Args: { target_date?: string };
        Returns: number;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
