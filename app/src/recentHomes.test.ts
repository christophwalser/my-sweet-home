// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  addRecentHome,
  clearRecentHomes,
  MAX_RECENT,
  recentHomes,
  recentLabel,
  removeRecentHome,
} from "./recentHomes";

const KEY = "msh.recentHomes";

beforeEach(() => {
  localStorage.clear();
});

describe("recent homes list", () => {
  it("is empty at first", () => {
    expect(recentHomes()).toEqual([]);
  });

  it("puts the newest home first", () => {
    addRecentHome("C:\\a.sh3d");
    addRecentHome("C:\\b.sh3d");
    expect(recentHomes()).toEqual(["C:\\b.sh3d", "C:\\a.sh3d"]);
  });

  it("moves a home opened again to the top without duplicating it", () => {
    addRecentHome("C:\\a.sh3d");
    addRecentHome("C:\\b.sh3d");
    addRecentHome("C:\\a.sh3d");
    expect(recentHomes()).toEqual(["C:\\a.sh3d", "C:\\b.sh3d"]);
  });

  it("treats paths that differ only in case as the same file", () => {
    addRecentHome("C:\\Homes\\House.sh3d");
    addRecentHome("c:\\homes\\house.SH3D");
    expect(recentHomes()).toEqual(["c:\\homes\\house.SH3D"]);
  });

  it(`keeps at most ${MAX_RECENT} entries, dropping the oldest`, () => {
    for (let i = 0; i < MAX_RECENT + 3; i++) addRecentHome(`C:\\home${i}.sh3d`);
    const list = recentHomes();
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]).toBe(`C:\\home${MAX_RECENT + 2}.sh3d`);
    expect(list).not.toContain("C:\\home0.sh3d");
    expect(list).not.toContain("C:\\home2.sh3d");
    expect(list).toContain("C:\\home3.sh3d");
  });

  it("removes a home, ignoring case", () => {
    addRecentHome("C:\\a.sh3d");
    addRecentHome("C:\\b.sh3d");
    removeRecentHome("C:\\A.SH3D");
    expect(recentHomes()).toEqual(["C:\\b.sh3d"]);
  });

  it("does nothing when removing an unknown home", () => {
    addRecentHome("C:\\a.sh3d");
    removeRecentHome("C:\\zzz.sh3d");
    expect(recentHomes()).toEqual(["C:\\a.sh3d"]);
  });

  it("clears the list", () => {
    addRecentHome("C:\\a.sh3d");
    clearRecentHomes();
    expect(recentHomes()).toEqual([]);
  });

  it("survives corrupt or foreign storage content", () => {
    localStorage.setItem(KEY, "{not json");
    expect(recentHomes()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify({ path: "C:\\a.sh3d" }));
    expect(recentHomes()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify(["C:\\a.sh3d", 42, null, "C:\\b.sh3d"]));
    expect(recentHomes()).toEqual(["C:\\a.sh3d", "C:\\b.sh3d"]);
  });

  it("can add to a corrupt list", () => {
    localStorage.setItem(KEY, "{not json");
    addRecentHome("C:\\a.sh3d");
    expect(recentHomes()).toEqual(["C:\\a.sh3d"]);
  });
});

describe("recentLabel", () => {
  it("shows the file name without the .sh3d extension", () => {
    expect(recentLabel("C:\\Homes\\House.sh3d", ["C:\\Homes\\House.sh3d"])).toBe("House");
    expect(recentLabel("C:\\Homes\\House.SH3D", [])).toBe("House");
  });

  it("keeps other extensions", () => {
    expect(recentLabel("C:\\Homes\\House.sh3d.bak", [])).toBe("House.sh3d.bak");
  });

  it("accepts forward slashes", () => {
    expect(recentLabel("/home/user/Flat.sh3d", [])).toBe("Flat");
  });

  it("adds the folder when two files share a name", () => {
    const all = ["C:\\Old\\House.sh3d", "C:\\New\\House.sh3d"];
    expect(recentLabel(all[0], all)).toBe("House (Old)");
    expect(recentLabel(all[1], all)).toBe("House (New)");
  });

  it("compares the names of twins ignoring case and extension case", () => {
    const all = ["C:\\Old\\house.SH3D", "C:\\New\\House.sh3d"];
    expect(recentLabel(all[0], all)).toBe("house (Old)");
  });

  it("shows no folder for unique names", () => {
    const all = ["C:\\Old\\House.sh3d", "C:\\New\\Flat.sh3d"];
    expect(recentLabel(all[0], all)).toBe("House");
  });

  it("shows no folder for a bare file name, even with twins", () => {
    expect(recentLabel("House.sh3d", ["House.sh3d", "C:\\x\\House.sh3d"])).toBe("House");
  });
});
