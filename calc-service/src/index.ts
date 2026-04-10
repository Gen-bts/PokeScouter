import express from "express";
import healthRouter from "./routes/health.js";
import damageRouter from "./routes/damage.js";

const PORT = parseInt(process.env.CALC_PORT ?? "3100", 10);

const app = express();

app.use(express.json({ limit: "1mb" }));

app.use(healthRouter);
app.use(damageRouter);

app.listen(PORT, () => {
  console.log(`calc-service listening on port ${PORT}`);
});

export default app;
