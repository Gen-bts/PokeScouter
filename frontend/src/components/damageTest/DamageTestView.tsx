import { useDamageTestCalc } from "../../hooks/useDamageTestCalc";
import { DamageTestSidePanel } from "./DamageTestSidePanel";
import { DamageTestFieldPanel } from "./DamageTestFieldPanel";
import { DamageTestResultPanel } from "./DamageTestResultPanel";

export function DamageTestView() {
  useDamageTestCalc();

  return (
    <div className="dt-view">
      <DamageTestFieldPanel />
      <div className="dt-sides-row">
        <DamageTestSidePanel role="attacker" />
        <DamageTestSidePanel role="defender" />
      </div>
      <DamageTestResultPanel />
    </div>
  );
}
