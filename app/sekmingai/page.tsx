// Čia klientas patenka grįžęs iš Paysera. Šis puslapis NEPATVIRTINA apmokėjimo –
// užsakymas pažymimas apmokėtu tik per /api/paysera/callback.
export default function PaymentAcceptedPage() {
  return (
    <main style={{ maxWidth: 560, margin: "12vh auto", padding: 24, textAlign: "center" }}>
      <h1>Ačiū! ♡</h1>
      <p>
        Jei apmokėjimas pavyko, užsakymą gausime per kelias minutes ir netrukus
        su tavimi susisieksime.
      </p>
      <p>
        <a href="/">Grįžti į svetainę</a>
      </p>
    </main>
  );
}
