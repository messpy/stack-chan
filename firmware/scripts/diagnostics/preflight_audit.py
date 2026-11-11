#!/usr/bin/env python3
"""Read-only audit of the installed StackChan management script and its Git targets."""
from __future__ import annotations

import ast
import hashlib
from pathlib import Path
import re
import subprocess

HOME = Path.home()
MAIN = HOME / "Stackchan_Projects" / "repository"
SCRIPT = HOME / "stackchan.sh"
ISSUE_COMMIT = "fcb159f7a05f"


def emit(level: str, step: str, message: str) -> None:
    print(f"[{level}] STEP={step} {message}")


def git(path: Path, *args: str) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            ["git", "-C", str(path), *args],
            capture_output=True, text=True, timeout=12, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, type(exc).__name__
    if result.returncode != 0:
        return False, "git_command_failed"
    return True, result.stdout.strip()


def embedded_python(source: str) -> tuple[str, int]:
    lines = source.splitlines()
    for index, line in enumerate(lines):
        match = re.search(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*$", line)
        if not match:
            continue
        delimiter = match.group(2)
        for end in range(index + 1, len(lines)):
            if lines[end].strip() == delimiter:
                return "\n".join(lines[index + 1:end]), index + 2
    return source, 1


def resolve_static_paths(tree: ast.Module) -> dict[str, Path]:
    known: dict[str, Path] = {"HOME": HOME}

    def parse(node: ast.AST) -> Path | str | None:
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        if isinstance(node, ast.Name):
            return known.get(node.id)
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
            left, right = parse(node.left), parse(node.right)
            if isinstance(left, Path) and isinstance(right, (Path, str)):
                return left / right
        if isinstance(node, ast.Call) and not node.keywords:
            func = node.func
            if isinstance(func, ast.Attribute) and func.attr == "home" and not node.args:
                if isinstance(func.value, ast.Name) and func.value.id in ("Path", "pathlib"):
                    return HOME
            if isinstance(func, ast.Attribute) and func.attr in ("expanduser", "resolve") and not node.args:
                value = parse(func.value)
                return value.expanduser() if isinstance(value, Path) else None
            is_path = isinstance(func, ast.Name) and func.id == "Path"
            is_path = is_path or (
                isinstance(func, ast.Attribute) and func.attr == "Path"
                and isinstance(func.value, ast.Name) and func.value.id == "pathlib"
            )
            if is_path and len(node.args) == 1:
                value = parse(node.args[0])
                return Path(value).expanduser() if isinstance(value, (Path, str)) else None
        return None

    for statement in tree.body:
        if isinstance(statement, ast.Assign) and len(statement.targets) == 1:
            name = statement.targets[0]
            value = parse(statement.value)
            if isinstance(name, ast.Name) and isinstance(value, Path):
                known[name.id] = value
        elif isinstance(statement, ast.AnnAssign) and isinstance(statement.target, ast.Name):
            if statement.value is not None:
                value = parse(statement.value)
                if isinstance(value, Path):
                    known[statement.target.id] = value
    return known


def describe_repo(name: str, path: Path) -> None:
    emit("CHECK", "REPO", f"NAME={name} PATH={path}")
    if not path.is_dir():
        emit("WARN", "REPO", f"NAME={name} STATUS=directory_missing")
        return
    ok, root = git(path, "rev-parse", "--show-toplevel")
    if not ok:
        emit("WARN", "REPO", f"NAME={name} STATUS=not_a_git_worktree")
        return
    branch_ok, branch = git(path, "symbolic-ref", "--quiet", "--short", "HEAD")
    head_ok, head = git(path, "rev-parse", "HEAD")
    status_ok, status = git(path, "status", "--porcelain=v1", "--untracked-files=no")
    dirty = len(status.splitlines()) if status_ok and status else (0 if status_ok else "unknown")
    object_ok, object_type = git(path, "cat-file", "-t", ISSUE_COMMIT)
    emit("INFO", "REPO", f"NAME={name} ROOT={root} BRANCH={branch if branch_ok else '(detached)'}")
    emit("INFO", "REPO", f"NAME={name} HEAD={head if head_ok else 'unavailable'} TRACKED_CHANGES={dirty} ISSUE_COMMIT={'present:' + object_type if object_ok else 'absent'}")


def main() -> int:
    emit("CHECK", "SCRIPT", f"PATH={SCRIPT}")
    if not SCRIPT.is_file():
        emit("FATAL", "SCRIPT", "REASON=management_script_missing")
        return 1
    binary = SCRIPT.read_bytes()
    emit("INFO", "SCRIPT", f"SHA256={hashlib.sha256(binary).hexdigest()} SIZE={len(binary)}")
    python_source, first_line = embedded_python(binary.decode("utf-8", "replace"))
    target = None
    try:
        tree = ast.parse(python_source)
        paths = resolve_static_paths(tree)
        target = paths.get("DEFAULT_REPO")
        definition_lines = [
            first_line + node.lineno - 1 for node in tree.body
            if isinstance(node, (ast.Assign, ast.AnnAssign))
            and any(isinstance(n, ast.Name) and n.id == "DEFAULT_REPO"
                    for n in (node.targets if isinstance(node, ast.Assign) else [node.target]))
        ]
        emit("INFO", "PARSE", f"DEFAULT_REPO_LINE={','.join(map(str, definition_lines)) if definition_lines else 'not_found'}")
        emit("INFO", "PARSE", f"DEFAULT_REPO={target if target is not None else 'not_statically_resolvable'}")
        has_override = any(isinstance(node, ast.Constant) and node.value == "--repo" for node in ast.walk(tree))
        emit("INFO", "PARSE", f"REPO_OVERRIDE_OPTION={has_override}")
        for node in ast.walk(tree):
            if isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call):
                if any(isinstance(item, ast.Constant) and isinstance(item.value, str)
                       and "tracked changes exist" in item.value for item in ast.walk(node.exc)):
                    emit("INFO", "PARSE", f"TRACKED_CHANGES_GUARD_LINE={first_line + node.lineno - 1}")
    except SyntaxError as exc:
        emit("WARN", "PARSE", f"REASON=python_syntax_not_parseable LINE={first_line + (exc.lineno or 1) - 1}")

    describe_repo("main", MAIN)
    if target is not None and target != MAIN:
        describe_repo("runner_default", target)
    elif target == MAIN:
        emit("INFO", "REPO", "RUNNER_DEFAULT_MATCHES_MAIN=true")
    else:
        describe_repo("legacy_candidate", HOME / "work" / "stackchan-context-recovery-20261109")

    ok, result = git(MAIN, "worktree", "list", "--porcelain") if MAIN.is_dir() else (False, "")
    if ok:
        trees = [line[len("worktree "):] for line in result.splitlines() if line.startswith("worktree ")]
        emit("INFO", "WORKTREE", f"COUNT={len(trees)}")
        if target is not None:
            emit("INFO", "WORKTREE", f"RUNNER_DEFAULT_REGISTERED={str(target) in trees}")
    else:
        emit("WARN", "WORKTREE", "REASON=cannot_enumerate")
    emit("INFO", "DONE", "MODE=read_only MODIFIED_FILES=0 OUTPUT=stdout_only")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
