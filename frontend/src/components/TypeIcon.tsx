import bugSvg from "../assets/types/bug.svg";
import darkSvg from "../assets/types/dark.svg";
import dragonSvg from "../assets/types/dragon.svg";
import electricSvg from "../assets/types/electric.svg";
import fairySvg from "../assets/types/fairy.svg";
import fightingSvg from "../assets/types/fighting.svg";
import fireSvg from "../assets/types/fire.svg";
import flyingSvg from "../assets/types/flying.svg";
import ghostSvg from "../assets/types/ghost.svg";
import grassSvg from "../assets/types/grass.svg";
import groundSvg from "../assets/types/ground.svg";
import iceSvg from "../assets/types/ice.svg";
import normalSvg from "../assets/types/normal.svg";
import poisonSvg from "../assets/types/poison.svg";
import psychicSvg from "../assets/types/psychic.svg";
import rockSvg from "../assets/types/rock.svg";
import steelSvg from "../assets/types/steel.svg";
import waterSvg from "../assets/types/water.svg";

const TYPE_ICONS: Record<string, string> = {
  bug: bugSvg,
  dark: darkSvg,
  dragon: dragonSvg,
  electric: electricSvg,
  fairy: fairySvg,
  fighting: fightingSvg,
  fire: fireSvg,
  flying: flyingSvg,
  ghost: ghostSvg,
  grass: grassSvg,
  ground: groundSvg,
  ice: iceSvg,
  normal: normalSvg,
  poison: poisonSvg,
  psychic: psychicSvg,
  rock: rockSvg,
  steel: steelSvg,
  water: waterSvg,
};

export function TypeIcon({
  type,
  size = 20,
  className,
}: {
  type: string;
  size?: number;
  className?: string;
}) {
  const src = TYPE_ICONS[type.toLowerCase()];
  if (!src) return null;
  return (
    <img
      src={src}
      alt={type}
      width={size}
      height={size}
      className={className}
    />
  );
}
