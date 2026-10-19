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
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import os from "os"

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..")
const INSTALL_SH_PATH = join(REPO_ROOT, "install")
const INSTALL_PS1 = readFileSync(join(REPO_ROOT, "install.ps1"), "utf-8")
const testUnlessWindows = process.platform === "win32" ? test.skip : test

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
    env: { ...process.env, HOME: home, XDG_DATA_HOME: join(home, "data"), GITHUB_ACTIONS: "" },
  })
  return { code: res.status ?? -1, stderr: res.stderr ?? "", bin: join(home, ".altimate", "bin") }
}

describe("install — altimate-code alias, executed", () => {
  testUnlessWindows("installs altimate-code as a relative link to altimate that runs it", () => {
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

  testUnlessWindows("replaces a stale altimate-code binary instead of leaving it on PATH", () => {
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

  testUnlessWindows("re-running the installer keeps a single working alias", () => {
    withHome((home) => {
      expect(runInstaller(home).code).toBe(0)
      const { code, bin } = runInstaller(home)
      expect(code).toBe(0)
      expect(readlinkSync(join(bin, "altimate-code"))).toBe("altimate")
    })
  })

  testUnlessWindows("replaces a link to a directory without writing into that directory", () => {
    withHome((home) => {
      const bin = join(home, ".altimate", "bin")
      const elsewhere = join(home, "elsewhere")
      mkdirSync(bin, { recursive: true })
      mkdirSync(elsewhere)
      symlinkSync(elsewhere, join(bin, "altimate-code"))
      const { code } = runInstaller(home)
      expect(code).toBe(0)
      expect(readlinkSync(join(bin, "altimate-code"))).toBe("altimate")
      expect(readdirSync(elsewhere)).toEqual([])
    })
  })

  testUnlessWindows("the already-installed exit still adds the alias", () => {
    withHome((home) => {
      const bin = join(home, ".altimate", "bin")
      const stubs = join(home, "stubs")
      mkdirSync(bin, { recursive: true })
      mkdirSync(stubs)
      writeFileSync(join(bin, "altimate"), "#!/bin/sh\necho 9.9.9\n", { mode: 0o755 })
      // The release-exists probe is the only network call on a pinned version.
      writeFileSync(join(stubs, "curl"), "#!/bin/sh\necho 200\n", { mode: 0o755 })
      const res = spawnSync("bash", [INSTALL_SH_PATH, "--version", "9.9.9", "--no-modify-path"], {
        encoding: "utf-8",
        env: {
          ...process.env,
          HOME: home,
          XDG_DATA_HOME: join(home, "data"),
          GITHUB_ACTIONS: "",
          PATH: `${stubs}:${bin}:${process.env.PATH}`,
        },
      })
      expect(res.stdout).toContain("already installed")
      expect(res.status).toBe(0)
      expect(readlinkSync(join(bin, "altimate-code"))).toBe("altimate")
    })
  })

  testUnlessWindows("a downloaded release gets the alias", () => {
    withHome((home) => {
      const stubs = join(home, "stubs")
      const pkg = join(home, "pkg")
      mkdirSync(stubs)
      mkdirSync(pkg)
      writeFileSync(join(pkg, "altimate"), '#!/bin/sh\necho downloaded "$@"\n', { mode: 0o755 })
      // Linux releases ship .tar.gz, every other target .zip (see `archive_ext` in install).
      const archive = join(home, "release")
      const pack =
        process.platform === "linux"
          ? spawnSync("tar", ["-czf", archive, "-C", pkg, "altimate"])
          : spawnSync("zip", ["-q", archive, "altimate"], { cwd: pkg })
      expect(pack.status).toBe(0)
      // Offline curl: the release-exists probe gets 200, the download gets the local
      // archive, and checksums.txt is missing (the installer then skips verification).
      writeFileSync(
        join(stubs, "curl"),
        [
          "#!/bin/sh",
          'out=""; prev=""',
          'for a in "$@"; do',
          '  [ "$a" = "-w" ] && { echo 200; exit 0; }',
          '  [ "$prev" = "-o" ] && out="$a"; prev="$a"',
          "done",
          `[ -n "$out" ] && exec cp "${archive}${process.platform === "linux" ? "" : ".zip"}" "$out"`,
          "exit 22",
          "",
        ].join("\n"),
        { mode: 0o755 },
      )
      const res = spawnSync("bash", [INSTALL_SH_PATH, "--version", "0.0.0-alias-test", "--no-modify-path"], {
        encoding: "utf-8",
        env: {
          ...process.env,
          HOME: home,
          XDG_DATA_HOME: join(home, "data"),
          GITHUB_ACTIONS: "",
          PATH: `${stubs}:${process.env.PATH}`,
        },
      })
      expect(res.stderr).not.toMatch(/syntax error|command not found/)
      expect(res.status).toBe(0)
      const alias = join(home, ".altimate", "bin", "altimate-code")
      expect(readlinkSync(alias)).toBe("altimate")
      expect(spawnSync(alias, ["--version"], { encoding: "utf-8" }).stdout.trim()).toBe("downloaded --version")
    })
  })

  testUnlessWindows("a --binary with an unrelated name gets no alias", () => {
    withHome((home) => {
      const { code, bin } = runInstaller(home, "altimate-dev")
      expect(code).toBe(0)
      expect(existsSync(join(bin, "altimate-dev"))).toBe(true)
      expect(existsSync(join(bin, "altimate-code"))).toBe(false)
    })
  })
})

describe("install.ps1 — altimate-code alias", () => {
  // Install-Alias itself is executed by test/windows/install.Tests.ps1; this pins its call sites.
  test("installs the alias after the binary and on the already-installed exit", () => {
    const calls = [...INSTALL_PS1.matchAll(/^\s*Install-Alias -Dir \$InstallDir\s*$/gm)].map((m) => m.index!)
    expect(calls.length).toBe(2)
    const alreadyInstalled = INSTALL_PS1.indexOf("already installed")
    const exitAfter = INSTALL_PS1.slice(alreadyInstalled).search(/^\s*exit 0\b/m) + alreadyInstalled
    expect(calls[0]).toBeGreaterThan(alreadyInstalled)
    expect(calls[0]).toBeLessThan(exitAfter)
    expect(calls[1]).toBeGreaterThan(INSTALL_PS1.indexOf("Install-Target -Baseline:$true"))
  })
})
