import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/login-form";

const { signInWithPassword } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({ auth: { signInWithPassword } }),
}));

describe("LoginForm", () => {
  beforeEach(() => {
    signInWithPassword.mockReset();
  });

  it("autentica com e-mail e senha sem solicitar código por e-mail", async () => {
    signInWithPassword.mockResolvedValue({ error: new Error("invalid credentials") });
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "dev@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Senha"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => {
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: "dev@example.com",
        password: "password123",
      });
    });
    expect(screen.getByText("E-mail ou senha inválidos.")).toBeInTheDocument();
  });
});
