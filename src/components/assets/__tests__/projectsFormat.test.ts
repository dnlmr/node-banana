import { describe, expect, it } from "vitest";
import { elsewhereTitle, elsewhereWhere, groupLabel, shortenHomePath } from "../projectsFormat";

describe("projectsFormat", () => {
  it("shortens a home folder to ~ on each platform", () => {
    expect(shortenHomePath("/Users/ada/Documents/Node Banana")).toBe("~/Documents/Node Banana");
    expect(shortenHomePath("/home/ada/Documents")).toBe("~/Documents");
    expect(shortenHomePath("C:\\Users\\ada\\Documents\\Node Banana")).toBe("~\\Documents\\Node Banana");
    expect(shortenHomePath("/Users/ada")).toBe("~");
    expect(shortenHomePath("/Volumes/Studio/Node Banana")).toBe("/Volumes/Studio/Node Banana");
    // Only a whole folder name counts
    expect(shortenHomePath("/Usersfoo/ada")).toBe("/Usersfoo/ada");
  });

  it("names a group's folder by its path under home", () => {
    expect(groupLabel("~/test-files/test workflows")).toBe("test-files › test workflows");
    expect(groupLabel("~\\Work\\Old")).toBe("Work › Old");
    expect(groupLabel("/Volumes/Studio")).toBe("Volumes › Studio");
    expect(groupLabel("~")).toBe("~");
  });

  it("says how many projects live elsewhere and where", () => {
    const elsewhere = {
      count: 14,
      dirs: [],
      bytes: 3.3e9,
      groups: [
        { label: "~/test-files/test workflows", count: 13 },
        { label: "~/pet-hype", count: 1 },
      ],
    };
    expect(elsewhereTitle(elsewhere)).toBe("14 projects live in other folders");
    expect(elsewhereTitle({ ...elsewhere, count: 1 })).toBe("1 project lives in another folder");
    expect(elsewhereWhere(elsewhere, true)).toMatch(/^test-files › test workflows \(13\) and pet-hype \(1\), 3\.3/);
    expect(elsewhereWhere(elsewhere, false)).toBe("test-files › test workflows and pet-hype");
    expect(
      elsewhereWhere({ ...elsewhere, groups: [...elsewhere.groups, { label: "~/c", count: 1 }] }, false)
    ).toBe("test-files › test workflows, pet-hype and c");
  });
});
