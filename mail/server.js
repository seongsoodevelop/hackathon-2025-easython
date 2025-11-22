import Koa from "koa";
import Router from "koa-router";
import bodyParser from "koa-bodyparser";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import axios from "axios";
import sound from "sound-play";
import notifier from "node-notifier";

dotenv.config();

const app = new Koa();
const router = new Router();

app.use(bodyParser());

// ✅ Nodemailer transporter
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT) || 587,
  secure: false, // 465 = true
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
  ignoreTLS: true,
});

const coord2address = async ({ longitude, latitude }) => {
  try {
    const response = await axios.get(
      `https://dapi.kakao.com/v2/local/geo/coord2address.json`,
      {
        params: {
          x: longitude,
          y: latitude,
        },
        headers: {
          Authorization: `KakaoAK ${process.env.KAKAO_REST_KEY}`,
        },
      }
    );
    return response.data.documents[0].road_address.address_name;
  } catch (e) {
    console.log(e);
    return null;
  }
};

// ✅ POST /send-mail
router.post("/send-mail", async (ctx) => {
  const { pos } = ctx.request.body;

  const address_name = await coord2address(pos);
  const str = `주소: ${address_name}, 상황: 비상상황, 시간: ${new Date().toLocaleString(
    "ko-KR",
    {
      timeZone: "Asia/Seoul",
    }
  )}`;

  try {
    await transporter.sendMail({
      from: process.env.MAIL_USER,
      to: "somangagain@gmail.com",
      subject: "[GuardianCall] 긴급신고입니다. 저희 고객이 도움이 필요합니다!",
      html: `<h1 color="red">${str}</h1>`,
    });

    console.log(
      `[GuardianCall] 긴급신고입니다. 저희 고객이 도움이 필요합니다! ${str}`
    );

    notifier.notify({
      title: "긴급신고 발생",
      message: `${str}`,
    });

    await sound.play("ding.mp3");

    ctx.body = { success: true, message: "메일 전송 완료 ✅" };
  } catch (err) {
    console.error("메일 전송 오류:", err);
    ctx.status = 500;
    ctx.body = { success: false, error: "메일 전송 실패 ❌" };
  }
});

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`✅ Mail server running on http://localhost:${PORT}`);
});
