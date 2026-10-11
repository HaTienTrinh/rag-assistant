import { redirectIfLoggedIn, setToken } from "../core/auth.js";
import { api } from "../core/api.js";
import { $ } from "../ui/dom.js";

async function initLoginPage() {
  // Nếu đã đăng nhập trước đó thì chuyển hướng thẳng về trang chat /
  await redirectIfLoggedIn();

  const form = $("#login-form");
  const errBox = $("#login-error");
  const submitBtn = $("#login-submit-btn");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    errBox.textContent = "";
    submitBtn.disabled = true;

    const email = $("#email").value.trim();
    const password = $("#password").value;

    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: new URLSearchParams({
          username: email,
          password: password,
        }),
      });

      setToken(data.access_token);
      window.location.href = "/";
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

initLoginPage();
