import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

transporter.verify((err) => {
  if (err) console.error("❌ Gmail SMTP failed:", err.message);
  else     console.log("✅ Gmail SMTP ready");
});

function buildHTML(otp, purpose) {
  const isReset  = purpose === "reset";
  const heading  = isReset ? "पासवर्ड रिसेट" : "इमेल प्रमाणीकरण";
  const bodyText = isReset
    ? "तपाईंको पासवर्ड रिसेट गर्न तलको OTP कोड प्रयोग गर्नुहोस्:"
    : "तपाईंको इमेल प्रमाणीकरण गर्न तलको OTP कोड प्रयोग गर्नुहोस्:";

  return `
<!DOCTYPE html><html lang="ne"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
  <tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0"
      style="background:#fff;border-radius:20px;overflow:hidden;
             box-shadow:0 4px 24px rgba(0,0,0,0.10)">
      <tr>
        <td style="background:linear-gradient(135deg,#1a3a6b,#c0392b);
                    padding:32px 40px;text-align:center">
          <div style="font-size:36px">🇳🇵</div>
          <h1 style="margin:8px 0 0;color:#fff;font-size:24px;font-weight:800">
            खेलौँ नेपाल
          </h1>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);
                     font-size:11px;letter-spacing:2px">KHELAUN NEPAL</p>
        </td>
      </tr>
      <tr>
        <td style="padding:40px">
          <h2 style="margin:0 0 12px;color:#1a3a6b">${heading}</h2>
          <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 28px">
            नमस्ते! 🙏<br/>${bodyText}
          </p>
          <div style="background:#f0f4ff;border:2px dashed #1a3a6b;
                       border-radius:14px;padding:28px;text-align:center;
                       margin-bottom:24px">
            <p style="margin:0 0 8px;color:#666;font-size:12px;
                        letter-spacing:2px;text-transform:uppercase">
              तपाईंको OTP कोड
            </p>
            <div style="font-size:48px;font-weight:900;letter-spacing:14px;
                          color:#1a3a6b;font-family:'Courier New',monospace">
              ${otp}
            </div>
            <p style="margin:12px 0 0;color:#e74c3c;font-size:13px;font-weight:600">
              ⏰ यो कोड 10 मिनेटसम्म मात्र मान्य छ
            </p>
          </div>
          <div style="background:#fffbf0;border-left:4px solid #f39c12;
                       padding:16px 20px;border-radius:0 10px 10px 0;
                       margin-bottom:24px">
            <p style="margin:0;color:#856404;font-size:13px;line-height:1.8">
              <strong>📌 निर्देशन:</strong><br/>
              1. एपमा फर्कनुहोस्<br/>
              2. माथिको ६-अंकको कोड राख्नुहोस्<br/>
              3. "प्रमाणीकरण गर्नुहोस्" थिच्नुहोस्
            </p>
          </div>
          <p style="color:#999;font-size:12px;line-height:1.7;margin:0">
            यदि तपाईंले यो अनुरोध गर्नुभएको छैन भने यो इमेल बेवास्ता गर्नुहोस्।
          </p>
        </td>
      </tr>
      <tr>
        <td style="background:#f8f9fc;padding:20px 40px;
                    text-align:center;border-top:1px solid #eee">
          <p style="margin:0;color:#aaa;font-size:11px;line-height:1.6">
            © ${new Date().getFullYear()} खेलौँ नेपाल — राष्ट्रिय खेलकुद विकास मञ्च<br/>
            यो स्वचालित इमेल हो। कृपया जवाफ नदिनुहोस्।
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export async function sendOTPEmail({ to, otp, purpose }) {
  const isReset = purpose === "reset";
  const subject = isReset
    ? "खेलौँ नेपाल — पासवर्ड रिसेट OTP"
    : "खेलौँ नेपाल — इमेल प्रमाणीकरण OTP";

  try {
    const info = await transporter.sendMail({
      from: `"${process.env.FROM_NAME}" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html: buildHTML(otp, purpose),
      text: `खेलौँ नेपाल OTP: ${otp} — यो कोड 10 मिनेटसम्म मान्य छ।`,
    });
    console.log(`✅ OTP sent to ${to} | ID: ${info.messageId}`);
    return info;
  } catch (err) {
    console.error(`❌ Email failed to ${to}:`, err.message);
    throw new Error("इमेल पठाउन असफल। पुनः प्रयास गर्नुहोस्।");
  }
}