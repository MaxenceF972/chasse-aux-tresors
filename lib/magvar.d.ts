/**
 * Déclaration minimale du paquet `magvar` (World Magnetic Model 2025-2030),
 * qui ne livre pas ses propres types. Seule la fonction utilisée est décrite.
 */
declare module "magvar" {
  /**
   * Déclinaison magnétique en degrés (positive = Est) au lieu donné.
   * `altitude` en kilomètres ; `when` : date ou année décimale, maintenant
   * par défaut.
   */
  export function magvar(
    latitude: number,
    longitude: number,
    altitude?: number,
    when?: Date | number
  ): number;
}
