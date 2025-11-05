import enquirer from "enquirer";

const SOURCE_URI_DEFAULT = process.env.MONGODB_SOURCE_URI ?? "";
const DESTINATION_URI_DEFAULT = process.env.MONGODB_DESTINATION_URI ?? "";

const trimAndUpper = (value: string | undefined): string | undefined =>
  value?.trim().toUpperCase();

export async function promptMongoUri(): Promise<string> {
  const response: any = await enquirer.prompt({
    type: "input",
    name: "uri",
    message: "Source MongoDB URI:",
    initial: SOURCE_URI_DEFAULT,
    validate: (input: string) =>
      input.trim().length > 0 || "Please provide a MongoDB connection string.",
  });

  return response.uri as string;
}

export async function promptDatabaseSelection(
  databaseNames: string[]
): Promise<string[]> {
  // Add "Select All" option
  const choices = ["[Select All]", ...databaseNames];

  const response: any = await enquirer.prompt({
    type: "multiselect",
    name: "databases",
    message: "Select databases to clone (space = toggle, enter = confirm):",
    choices: choices,
  });

  const selected = response.databases as string[];

  // If "Select All" is selected, return all databases
  if (selected.includes("[Select All]")) {
    return databaseNames;
  }

  return selected;
}

export async function promptDestinationMongoUri(): Promise<string> {
  const response: any = await enquirer.prompt({
    type: "input",
    name: "uri",
    message: "Destination MongoDB URI:",
    initial: DESTINATION_URI_DEFAULT,
    validate: (input: string) =>
      input.trim().length > 0 || "Please provide a MongoDB connection string.",
  });

  return response.uri as string;
}

export async function promptToBeSure(): Promise<"Y" | "N"> {
  let decision: string | undefined;

  do {
    const answer = await enquirer.prompt<{ decision: string }>({
      type: "input",
      name: "decision",
      message: "Ready to start cloning? (Y/N)",
    });
    decision = trimAndUpper(answer.decision);
  } while (decision !== "Y" && decision !== "N");

  return decision;
}

export async function promptConflictResolution(
  conflictingDatabases: string[]
): Promise<{
  overwrite: string[];
  skip: string[];
  cancelled: boolean;
}> {
  const overwrite: string[] = [];
  const skip: string[] = [];

  for (const dbName of conflictingDatabases) {
    const answer = await enquirer.prompt<{
      action: "overwrite" | "skip" | "cancel";
    }>({
      type: "select",
      name: "action",
      message: `Destination already contains "${dbName}". Choose an action:`,
      choices: [
        {
          name: "overwrite",
          message: "Overwrite destination copy",
          value: "overwrite",
        },
        {
          name: "skip",
          message: "Skip cloning this database",
          value: "skip",
        },
        {
          name: "cancel",
          message: "Cancel entire clone run",
          value: "cancel",
        },
      ],
    });

    if (answer.action === "cancel") {
      return { overwrite, skip, cancelled: true };
    }

    if (answer.action === "overwrite") {
      overwrite.push(dbName);
    } else {
      skip.push(dbName);
    }
  }

  return { overwrite, skip, cancelled: false };
}
