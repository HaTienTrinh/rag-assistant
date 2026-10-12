import secrets
from app.auth import validate_password_rules

# Bảng ký tự không gây nhầm lẫn: loại bỏ 0, O, 1, l, I
UNAMBIGUOUS_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
UNAMBIGUOUS_DIGITS = "23456789"
UNAMBIGUOUS_ALL = UNAMBIGUOUS_LETTERS + UNAMBIGUOUS_DIGITS


def generate_temp_password(length: int = 12) -> str:
    """Sinh mật khẩu tạm ngẫu nhiên an toàn bằng module secrets.

    - Độ dài 12 ký tự từ bảng chữ không gây nhầm lẫn (loại 0, O, 1, l, I).
    - Bảo đảm có ít nhất một chữ và ít nhất một số.
    - Vượt qua kiểm tra validate_password_rules.
    """
    if length < 8:
        length = 12

    rng = secrets.SystemRandom()
    while True:
        # Đảm bảo có ít nhất 1 chữ cái và 1 chữ số
        chars = [
            rng.choice(UNAMBIGUOUS_LETTERS),
            rng.choice(UNAMBIGUOUS_DIGITS),
        ] + [rng.choice(UNAMBIGUOUS_ALL) for _ in range(length - 2)]

        rng.shuffle(chars)
        pwd = "".join(chars)

        try:
            validate_password_rules(pwd)
            return pwd
        except Exception:
            continue
