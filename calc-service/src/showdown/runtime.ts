import showdownPkg from "pokemon-showdown";

const showdown = showdownPkg?.default ?? showdownPkg;

export function getShowdown(): any {
  return showdown;
}

export function getDex(): any {
  return showdown.Dex;
}

export function createValidator(format: string): any {
  return new showdown.TeamValidator(format);
}
