/// <reference path="../.astro/types.d.ts" />

declare namespace App {
  interface Locals {
    user?: import('./types/domain').SessionUser
  }
}
