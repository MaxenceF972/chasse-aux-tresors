# Product

## Register

product

## Users

- **Joueurs** : équipes (familles, enfants dès 7 ans, groupes d'amis, collègues) sur smartphone, **en extérieur, en marchant, souvent en plein soleil**. Une main sur le téléphone, l'autre occupée. Réseau parfois instable. Ils veulent jouer, pas apprendre une interface.
- **Organisateurs** : un particulier ou animateur qui prépare le parcours depuis son téléphone ou PC, puis pilote la partie **sur le terrain, depuis son téléphone**, en gérant plusieurs équipes à la fois.

## Product Purpose

TOYAH GAMES fait vivre des chasses au trésor réelles, en temps réel : l'organisateur cache des balises NFC/QR et compose un parcours d'énigmes et de mini-jeux ; les équipes s'affrontent sur le terrain, chacune sur sa propre route (anti-suivi). Succès = une partie qui se déroule sans friction technique : rejoindre en 30 secondes, valider d'un geste, aucun joueur bloqué.

## Brand Personality

Aventure, ludique, généreux. L'app doit **ressembler à un jeu, pas à un SaaS** : contours noirs épais façon cartoon, ombres franches, typographie display impactante (lettrage du logo), animations qui récompensent. Ton des textes : complice et pirate (« En avant ! », « Hisser le drapeau »), jamais corporate.

## Anti-references

- Le template SaaS générique (cartes grises, tableaux, sidebar) — explicitement exclu par le brief.
- Les apps d'escape game surchargées où l'on cherche le bouton.
- Tout ce qui exige un compte, un tutoriel ou un App Store côté joueur.

## Design Principles

1. **Jouable d'un pouce, en marchant** : cibles tactiles généreuses (≥44px), actions primaires en bas d'écran, zéro hover-dépendance.
2. **Lisible en plein soleil** : contrastes élevés (encre #111 sur parchemin #EDE0C4), gros corps de texte, pas de gris timides.
3. **Le jeu récompense** : chaque validation est une petite fête (son, vibration, tampon ✗) ; chaque erreur est encaissée avec humour, jamais punitive.
4. **Zéro friction, zéro impasse** : un code suffit pour jouer, chaque écran a un retour évident, le hors-ligne est encaissé, un fallback existe toujours (NFC → QR → code).
5. **L'organisateur voit tout, agit en deux taps** : le dashboard live est une tour de contrôle, pas un tableur.

## Accessibility & Inclusion

- Contraste AA minimum sur tous les textes (usage extérieur = exigence renforcée).
- Sons et vibrations toujours débrayables (bouton mute).
- Pas d'information portée par la couleur seule (les équipes ont nom + couleur).
- `prefers-reduced-motion` respecté sur les animations décoratives.
- Public enfant : vocabulaire simple, icônes + texte, jamais de texte seul minuscule.
