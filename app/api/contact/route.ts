import nodemailer from "nodemailer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const data = await request.json();

    const name = String(data.name ?? "").trim();
    const email = String(data.email ?? "").trim();
    const subject = String(data.subject ?? "Užklausa iš svetainės")
      .replace(/[\r\n]+/g, " ")
      .slice(0, 120);
    const message = String(data.message ?? "").trim();
    const orderSummary = String(data.orderSummary ?? "").trim();

    if (!name || !email || !message) {
      return Response.json(
        { error: "Užpildyk visus privalomus laukus." },
        { status: 400 }
      );
    }

    const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (
      !emailIsValid ||
      name.length > 100 ||
      email.length > 254 ||
      message.length > 5000 ||
      orderSummary.length > 15000
    ) {
      return Response.json(
        { error: "Patikrink įvestus duomenis ir bandyk dar kartą." },
        { status: 400 }
      );
    }

    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpHost = process.env.SMTP_HOST || "smtp.hostinger.com";
    const smtpPort = Number(process.env.SMTP_PORT || 465);

    if (!smtpUser || !smtpPass || ![465, 587].includes(smtpPort)) {
      console.error("SMTP nustatymai nesukonfigūruoti arba neteisingi.");
      return Response.json(
        { error: "El. pašto siuntimas šiuo metu nesukonfigūruotas." },
        { status: 500 }
      );
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });

    // Laiškas siunčiamas tik iš serverio. Reply-To leidžia savininkui
    // paspausti „Atsakyti“ ir atsakyti tiesiai svetainės lankytojui.
    await transporter.sendMail({
      from: `"Gudrutės dėžutės" <${smtpUser}>`,
      to: process.env.CONTACT_TO || smtpUser,
      replyTo: {
        name,
        address: email,
      },
      subject: `Svetainės užklausa: ${subject}`,
      text: [
        "Gauta nauja užklausa iš gudrutesdezutes.lt",
        "",
        `Vardas: ${name}`,
        `Lankytojo el. paštas: ${email}`,
        `Tema: ${subject}`,
        "",
        "Žinutė:",
        message,
        "",
        orderSummary,
      ].join("\n"),
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error("Nepavyko išsiųsti svetainės užklausos:", error);
    return Response.json(
      { error: "Nepavyko išsiųsti laiško. Bandyk dar kartą arba parašyk tiesiai į info@gudrutesdezutes.lt." },
      { status: 500 }
    );
  }
}
