"use client";

import { useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "sent" | "error">("idle");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("loading");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setState(error ? "error" : "sent");
  }

  if (state === "sent") {
    return <p className="login-success">Link enviado. Verifique sua caixa de entrada.</p>;
  }

  return (
    <form onSubmit={submit} className="login-form">
      <label htmlFor="email">E-mail</label>
      <div className="login-input-wrap">
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="voce@agencia.com"
        />
        <button type="submit" disabled={state === "loading"} aria-label="Entrar">
          {state === "loading" ? <LoaderCircle className="spin" /> : <ArrowRight />}
        </button>
      </div>
      {state === "error" && <p className="form-error">Não foi possível enviar o link.</p>}
    </form>
  );
}
