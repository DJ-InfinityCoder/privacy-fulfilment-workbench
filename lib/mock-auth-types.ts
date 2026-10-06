export const mockRoleCookieName = "privacy-workbench-role";

export const mockRoles = ["analyst", "approver"] as const;
export type MockRole = (typeof mockRoles)[number];

export type DemoUser = {
  id: string;
  name: string;
  role: MockRole;
};

export const demoUsers: Record<MockRole, DemoUser> = {
  analyst: {
    id: "u-analyst",
    name: "Asha (Analyst)",
    role: "analyst",
  },
  approver: {
    id: "u-approver",
    name: "Rahul (Approver)",
    role: "approver",
  },
};

export function parseMockRole(value: string | undefined): MockRole {
  return (mockRoles as readonly string[]).includes(value ?? "")
    ? (value as MockRole)
    : "analyst";
}
