import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark">T</div>
        <p className="eyebrow">THIGAS</p>
        <h1>Seu trabalho, bem medido.</h1>
        <p className="login-copy">
          Entre com seu e-mail. Você receberá um link seguro e sem senha.
        </p>
        <LoginForm />
      </section>
    </main>
  );
}
