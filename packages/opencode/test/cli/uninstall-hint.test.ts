import { describe, expect, test } from "bun:test"
import { installerSiblingFiles } from "../../src/cli/cmd/uninstall"

describe("uninstall — installer files beside the binary", () => {
  test("names the alias next to a standalone unix install", () => {
    expect(installerSiblingFiles("/home/u/.altimate/bin/altimate", "linux")).toEqual([
      "/home/u/.altimate/bin/altimate-code",
    ])
  })

  test("names every Windows alias form next to altimate.exe", () => {
    expect(installerSiblingFiles("C:\\Users\\u\\.altimate\\bin\\altimate.exe", "win32")).toEqual([
      "C:\\Users\\u\\.altimate\\bin\\altimate-code.cmd",
      "C:\\Users\\u\\.altimate\\bin\\altimate-code",
      "C:\\Users\\u\\.altimate\\bin\\altimate-code.exe",
    ])
  })

  test("names the canonical binary when running from a copied alias", () => {
    expect(installerSiblingFiles("C:\\Users\\u\\.altimate\\bin\\ALTIMATE-CODE.EXE", "win32")).toEqual([
      "C:\\Users\\u\\.altimate\\bin\\altimate.exe",
      "C:\\Users\\u\\.altimate\\bin\\altimate-code.cmd",
      "C:\\Users\\u\\.altimate\\bin\\altimate-code",
    ])
  })

  test("names nothing outside the installers' own directory", () => {
    expect(installerSiblingFiles("/home/u/.local/bin/altimate", "linux")).toEqual([])
    expect(installerSiblingFiles("/home/u/.opencode/bin/altimate", "linux")).toEqual([])
  })
})
