import { getRedis } from "../redis";
import type { Employee } from "../workflow/types";

const EMPLOYEES_KEY = "shiftrescue:employees";

/**
 * Starting roster, used only to seed an empty store on first run so a fresh
 * environment is usable. Once seeded these are ordinary editable records — the
 * store is the source of truth, not this array.
 */
function seedRoster(): Employee[] {
  return [
    { id: "worker-1", name: "Maria Alvarez", phone: process.env.DEMO_WORKER_1_PHONE || "", language: "Spanish", role: "Kitchen Assistant", active: true },
    { id: "worker-2", name: "Ahmed Khan", phone: process.env.DEMO_WORKER_2_PHONE || "", language: "Urdu", role: "Kitchen Assistant", active: true },
    { id: "worker-3", name: "John Byrne", phone: process.env.DEMO_WORKER_3_PHONE || "", language: "English", role: "Kitchen Assistant", active: true },
  ];
}

const globalForEmployees = globalThis as unknown as { employees: Employee[] | undefined };

export async function listEmployees(): Promise<Employee[]> {
  const redis = getRedis();

  if (!redis) {
    if (!globalForEmployees.employees) globalForEmployees.employees = seedRoster();
    return globalForEmployees.employees;
  }

  const stored = await redis.get<Employee[]>(EMPLOYEES_KEY);
  if (stored && stored.length > 0) return stored;

  const seeded = seedRoster();
  await redis.set(EMPLOYEES_KEY, seeded);
  return seeded;
}

async function saveEmployees(employees: Employee[]): Promise<Employee[]> {
  const redis = getRedis();
  if (!redis) {
    globalForEmployees.employees = employees;
    return employees;
  }
  await redis.set(EMPLOYEES_KEY, employees);
  return employees;
}

/**
 * Employees the workflow will work through, in call order.
 *
 * Deliberately not filtered by phone number: someone with no number on file is
 * still on the roster, and the call layer reports that honestly when it reaches
 * them. Filtering here made a freshly seeded environment look like it had no
 * staff at all.
 */
export async function callableEmployees(): Promise<Employee[]> {
  return (await listEmployees()).filter((e) => e.active);
}

export interface EmployeeInput {
  name?: string;
  phone?: string;
  language?: string;
  role?: string;
  active?: boolean;
}

function validate(input: EmployeeInput, { partial }: { partial: boolean }): void {
  const required: Array<keyof EmployeeInput> = ["name", "phone", "language"];
  const missing = required.filter(
    (field) => !partial && (typeof input[field] !== "string" || String(input[field]).trim() === ""),
  );
  if (missing.length > 0) throw new Error(`Missing required fields: ${missing.join(", ")}`);

  if (typeof input.phone === "string" && input.phone.trim() !== "" && !/^\+[1-9]\d{6,15}$/.test(input.phone.trim())) {
    throw new Error("Phone must be in E.164 format, e.g. +14155550123");
  }
}

export async function createEmployee(input: EmployeeInput): Promise<Employee> {
  validate(input, { partial: false });
  const employees = await listEmployees();

  const employee: Employee = {
    id: `emp_${Math.random().toString(36).slice(2, 10)}`,
    name: input.name!.trim(),
    phone: input.phone!.trim(),
    language: input.language!.trim(),
    role: input.role?.trim() || "",
    active: input.active ?? true,
  };

  await saveEmployees([...employees, employee]);
  return employee;
}

export async function updateEmployee(id: string, input: EmployeeInput): Promise<Employee> {
  validate(input, { partial: true });
  const employees = await listEmployees();
  const index = employees.findIndex((e) => e.id === id);
  if (index < 0) throw new Error(`No employee with id ${id}`);

  const updated: Employee = {
    ...employees[index],
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.phone !== undefined ? { phone: input.phone.trim() } : {}),
    ...(input.language !== undefined ? { language: input.language.trim() } : {}),
    ...(input.role !== undefined ? { role: input.role.trim() } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
  };

  const next = [...employees];
  next[index] = updated;
  await saveEmployees(next);
  return updated;
}

export async function deleteEmployee(id: string): Promise<void> {
  const employees = await listEmployees();
  if (!employees.some((e) => e.id === id)) throw new Error(`No employee with id ${id}`);
  await saveEmployees(employees.filter((e) => e.id !== id));
}

/** Reset the roster to the starting set — used by the ops console only. */
export async function resetEmployees(): Promise<Employee[]> {
  return saveEmployees(seedRoster());
}
