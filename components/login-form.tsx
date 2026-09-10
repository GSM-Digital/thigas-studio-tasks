"use client";

import { useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("loading");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setState("error");
      return;
    }
    window.location.replace("/");
  }

  return (
    <form onSubmit={submit} className="login-form">
      <div className="login-field">
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
        </div>
      </div>
      <div className="login-field">
        <label htmlFor="password">Senha</label>
        <div className="login-input-wrap">
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Sua senha"
          />
          <button type="submit" disabled={state === "loading"} aria-label="Entrar">
            {state === "loading" ? <LoaderCircle className="spin" /> : <ArrowRight />}
          </button>
        </div>
      </div>
      {state === "error" && <p className="form-error">E-mail ou senha inválidos.</p>}
    </form>
  );
}
