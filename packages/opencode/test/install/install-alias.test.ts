/**
 * The standalone installers expose `altimate-code` beside `altimate`, the same
 * pair of names npm, Homebrew and AUR ship. These run the real bash installer
 * through its `--binary` path (no network) against a throwaway HOME. install.ps1
 * gets source-level checks here and execution in test/windows/install.Tests.ps1.
 */
import { describe, expect, test } from "bun:test"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import os from "os"

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..")
const INSTALL_SH_PATH = join(REPO_ROOT, "install")
const INSTALL_PS1 = readFileSync(join(REPO_ROOT, "install.ps1"), "utf-8")
const shtest = process.platform === "win32" ? test.skip : test

function withHome(fn: (home: string) => void) {
  const home = mkdtempSync(join(os.tmpdir(), "install-alias-home-"))
  try {
    fn(home)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

function runInstaller(home: string, binaryName = "altimate") {
  const src = join(home, "src")
  mkdirSync(src, { recursive: true })
  const fakeBin = join(src, binaryName)
  writeFileSync(fakeBin, '#!/bin/sh\necho fake-altimate "$@"\n', { mode: 0o755 })
  const res = spawnSync("bash", [INSTALL_SH_PATH, "--binary", fakeBin, "--no-modify-path"], {
    encoding: "utf-8",
    env: { ...process.env, HOME: home, XDG_DATA_HOME: join(home, "data") },
  })
  return { code: res.status ?? -1, stderr: res.stderr ?? "", bin: join(home, ".altimate", "bin") }
}

describe("install — altimate-code alias, executed", () => {
  shtest("installs altimate-code as a relative link to altimate that runs it", () => {
    withHome((home) => {
      const { code, bin, stderr } = runInstaller(home)
      expect(stderr).not.toMatch(/syntax error|command not found/)
      expect(code).toBe(0)
      const alias = join(bin, "altimate-code")
      expect(lstatSync(alias).isSymbolicLink()).toBe(true)
      expect(readlinkSync(alias)).toBe("altimate")
      const run = spawnSync(alias, ["--version"], { encoding: "utf-8" })
      expect(run.stdout.trim()).toBe("fake-altimate --version")
    })
  })

  shtest("replaces a stale altimate-code binary instead of leaving it on PATH", () => {
    withHome((home) => {
      const bin = join(home, ".altimate", "bin")
      mkdirSync(bin, { recursive: true })
      writeFileSync(join(bin, "altimate-code"), "#!/bin/sh\necho stale\n", { mode: 0o755 })
      const { code } = runInstaller(home)
      expect(code).toBe(0)
      expect(lstatSync(join(bin, "altimate-code")).isSymbolicLink()).toBe(true)
      expect(spawnSync(join(bin, "altimate-code"), [], { encoding: "utf-8" }).stdout.trim()).toBe("fake-altimate")
    })
  })

  shtest("re-running the installer keeps a single working alias", () => {
    withHome((home) => {
      expect(runInstaller(home).code).toBe(0)
      const { code, bin } = runInstaller(home)
      expect(code).toBe(0)
      expect(readlinkSync(join(bin, "altimate-code"))).toBe("altimate")
    })
  })

  shtest("a --binary with an unrelated name gets no alias", () => {
    withHome((home) => {
      const { code, bin } = runInstaller(home, "altimate-dev")
      expect(code).toBe(0)
      expect(existsSync(join(bin, "altimate-dev"))).toBe(true)
      expect(existsSync(join(bin, "altimate-code"))).toBe(false)
    })
  })
})

describe("install.ps1 — altimate-code alias", () => {
  test("installs the alias after the binary and on the already-installed exit", () => {
    const calls = [...INSTALL_PS1.matchAll(/^\s*Install-Alias -Dir \$InstallDir$/gm)].map((m) => m.index!)
    expect(calls.length).toBe(2)
    const exit = INSTALL_PS1.indexOf('Write-Muted "Version $specificVersion already installed"')
    expect(calls[0]).toBeGreaterThan(exit)
    expect(calls[0]).toBeLessThan(INSTALL_PS1.indexOf("    exit 0", exit))
    expect(calls[1]).toBeGreaterThan(INSTALL_PS1.indexOf("Install-Target -Baseline:$true"))
  })

  test("the shim forwards arguments and the exit code to altimate.exe", () => {
    expect(INSTALL_PS1).toContain('"@echo off`r`n`"%~dp0altimate.exe`" %*`r`nexit /b %ERRORLEVEL%`r`n"')
  })
})
