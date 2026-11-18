"""Utilitários de linha de comando.

    python -m app.cli create-admin --username admin --email ti@updown.com.br
    python -m app.cli seed-groups
"""
import argparse
import getpass
import sys

from sqlalchemy import func, select

from app.core.security import hash_password
from app.database import SessionLocal
from app.models import ScreenGroup, User
from app.models.enums import Role
from app.schemas.users import _check_password

DEFAULT_GROUPS = ["NOC", "Administrativo", "Comercial", "Recepção", "Financeiro", "Operações"]


def create_admin(args) -> int:
    password = args.password or getpass.getpass("Senha: ")
    try:
        _check_password(password)
    except ValueError as e:
        print(f"Erro: {e}", file=sys.stderr)
        return 1
    with SessionLocal() as db:
        if db.scalar(select(User).where(func.lower(User.username) == args.username.lower())):
            print("Erro: usuário já existe", file=sys.stderr)
            return 1
        db.add(User(username=args.username, email=args.email, full_name=args.name or args.username,
                    role=Role.ADMIN.value, password_hash=hash_password(password)))
        db.commit()
    print(f"Administrador '{args.username}' criado.")
    return 0


def seed_groups(_args) -> int:
    with SessionLocal() as db:
        existing = {g.lower() for g in db.scalars(select(ScreenGroup.name)).all()}
        created = [n for n in DEFAULT_GROUPS if n.lower() not in existing]
        for n in created:
            db.add(ScreenGroup(name=n))
        db.commit()
    print("Grupos criados: " + (", ".join(created) or "nenhum (já existiam)"))
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="python -m app.cli")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("create-admin", help="cria um usuário administrador")
    a.add_argument("--username", required=True)
    a.add_argument("--email")
    a.add_argument("--name")
    a.add_argument("--password", help="(evite: fica no histórico do shell; omita para digitar)")
    a.set_defaults(func=create_admin)
    g = sub.add_parser("seed-groups", help="cria os grupos padrão")
    g.set_defaults(func=seed_groups)
    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
