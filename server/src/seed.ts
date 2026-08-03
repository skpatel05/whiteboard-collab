import * as Y from "yjs";
import bcrypt from "bcryptjs";
import { env } from "./config/env";
import { connectDatabase, disconnectDatabase } from "./lib/database";
import { User } from "./models/User";
import { Workspace } from "./models/Workspace";
import { Board } from "./models/Board";
import { BoardOp } from "./models/BoardOp";
import { Note } from "./models/Note";
import { logger } from "./lib/logger";

/**
 * Seeds demo data so an interviewer can explore the app immediately:
 *   1. two verified users (owner + collaborator)
 *   2. a shared workspace with a collaborator member
 *   3. a pre-populated board (Yjs shapes + meeting minutes) and one blank board
 *
 * Run: npm run seed   (from repo root) or  npx tsx src/seed.ts   (from server/)
 * Idempotent: re-running replaces the seeded users/boards.
 */

const DEMO_PASSWORD = "demo1234";
const OWNER = { name: "Ankita Sharma", email: "owner@whiteboard.local" };
const COLLAB = { name: "Rahul Verma", email: "collab@whiteboard.local" };

function makeShapesDoc(): { doc: Y.Doc; shapes: Y.Map<unknown> } {
  const doc = new Y.Doc();
  const shapes = doc.getMap<unknown>("shapes");
  shapes.set("sticky-agenda", {
    id: "sticky-agenda",
    type: "sticky",
    x: 80,
    y: 120,
    width: 200,
    height: 170,
    color: "#fde68a",
    text: "Agenda\n• Q3 targets\n• Design review\n• Launch checklist",
  });
  shapes.set("sticky-owner", {
    id: "sticky-owner",
    type: "sticky",
    x: 340,
    y: 120,
    width: 200,
    height: 170,
    color: "#bbf7d0",
    text: "Owner: Ankita\nShip v2 dashboard\nby Friday",
  });
  shapes.set("rect-flow", {
    id: "rect-flow",
    type: "rect",
    x: 620,
    y: 150,
    width: 180,
    height: 90,
    stroke: "#3b82f6",
    strokeWidth: 3,
    fill: "#eff6ff",
  });
  shapes.set("ellipse-idea", {
    id: "ellipse-idea",
    type: "ellipse",
    x: 820,
    y: 200,
    width: 120,
    height: 120,
    stroke: "#8b5cf6",
    strokeWidth: 3,
    fill: "#f5f3ff",
  });
  shapes.set("arrow1", {
    id: "arrow1",
    type: "arrow",
    points: [800, 195, 700, 195],
    stroke: "#1e293b",
    strokeWidth: 2,
  });
  shapes.set("pen1", {
    id: "pen1",
    type: "pen",
    points: [120, 360, 160, 340, 200, 380, 260, 350, 320, 390],
    stroke: "#f97316",
    strokeWidth: 3,
  });
  return { doc, shapes };
}

async function seed(): Promise<void> {
  await connectDatabase();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const upsertUser = async (name: string, email: string) => {
    const user = await User.findOneAndUpdate(
      { email },
      { $set: { name, passwordHash, emailVerifiedAt: new Date() } },
      { upsert: true, new: true },
    );
    return user;
  };

  const owner = await upsertUser(OWNER.name, OWNER.email);
  const collab = await upsertUser(COLLAB.name, COLLAB.email);

  let workspace = await Workspace.findOne({ name: "Product Team" });
  if (!workspace) {
    workspace = await Workspace.create({
      name: "Product Team",
      description: "Seed workspace for the interview demo",
      owner: owner._id,
      members: [{ user: collab._id, role: "editor" }],
    });
  } else {
    workspace.owner = owner._id;
    if (!workspace.members.some((m) => String(m.user) === String(collab._id))) {
      workspace.members.push({ user: collab._id, role: "editor" });
    }
    await workspace.save();
  }

  const seedBoards: { title: string; description: string; populated: boolean }[] = [
    {
      title: "Sprint Review — Q3 Planning",
      description: "Collaborative board pre-populated with sticky notes, shapes and minutes.",
      populated: true,
    },
    { title: "Design Brainstorm", description: "Blank board — draw anything!", populated: false },
  ];

  for (const seed of seedBoards) {
    await Board.deleteMany({ title: seed.title, workspace: workspace._id });
    const board = await Board.create({
      workspace: workspace._id,
      title: seed.title,
      description: seed.description,
      createdBy: owner._id,
    });

    if (seed.populated) {
      const { doc } = makeShapesDoc();
      const payload = Buffer.from(Y.encodeStateAsUpdate(doc));
      await BoardOp.create({
        board: board._id,
        user: owner._id,
        kind: "snapshot",
        version: 1,
        baseVersion: 0,
        payload,
      });
      await Board.updateOne({ _id: board._id }, { $set: { currentVersion: 1, lastSnapshotVersion: 1 } });

      await Note.create({
        board: board._id,
        kind: "minutes",
        author: owner._id,
        content: [
          "# Sprint Review — Q3 Planning",
          "",
          "**Attendees:** Ankita (owner), Rahul (editor), Priya (viewer)",
          "",
          "## Decisions",
          "- Ship the v2 dashboard this sprint, freeze new features.",
          "- Adopt the shared design system for all whiteboards.",
          "",
          "## Action items",
          "- Action item: Ankita to finalize the v2 dashboard scope",
          "- Todo: Rahul to draft the API changelog",
          "- Owner: Priya to schedule the launch review",
          "",
          "## Next steps",
          "- Finalize the launch plan tomorrow.",
        ].join("\n"),
      });
    }

    logger.info(`Seeded board "${seed.title}" (id=${String(board._id)})`);
  }

  await disconnectDatabase();

  logger.info("──────────────────────────────────────────────");
  logger.info("Seed complete. Demo logins (email / password):");
  logger.info(`  ${OWNER.email}  /  ${DEMO_PASSWORD}   (owner)`);
  logger.info(`  ${COLLAB.email}  /  ${DEMO_PASSWORD}   (editor)`);
  logger.info(`MongoDB: ${env.mongoUri}`);
  logger.info("──────────────────────────────────────────────");
}

seed().catch((err) => {
  logger.error("Seeding failed", err);
  process.exit(1);
});
