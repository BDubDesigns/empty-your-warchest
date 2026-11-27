# Stress test credits

Models and textures for Debug → Stress test only; nothing here is loaded in normal play. All CC0
(public domain): https://creativecommons.org/publicdomain/zero/1.0/ (each pack's license file says
so).

| Files                                                                   | Source                                                                                                                              |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| kenney/castle.glb, kenney/castle-colormap.png                           | Kenney, Castle Kit 2.0: 15 pieces merged into one file, as shipped                                                                  |
| kenney/mini/\*.glb, kenney/mini/Textures/colormap.png                   | Kenney, Mini Characters 2.0: soldier, knight, male A, female A, as shipped (their clips included)                                   |
| village/pieces.glb                                                      | Quaternius, Medieval Village MegaKit (Standard): 17 pieces merged into one file                                                     |
| village/Male_Peasant, Female_Peasant, Male_Ranger, Female_Ranger (.glb) | Quaternius, Modular Character Outfits – Fantasy (Standard), each with the head of Quaternius' Universal Base Characters (Superhero) |
| village/animations.glb                                                  | Quaternius, Universal Animation Library (Standard): Idle_Loop and Walk_Loop, rotations (and the hips' height) only                  |
| village/tex/\*.jpg                                                      | The textures of the Quaternius packs above, shrunk to at most 1024 px and saved as JPEG                                             |
| village/tex-full/\*.jpg                                                 | The same at full size (2048 px; the outfits 4096 px), saved as JPEG                                                                 |

Changes: pieces merged so their materials and textures are shared; the Quaternius packs' vertex
colours and extra UV sets dropped (they're masks for the packs' own shaders, and three.js would
tint the models with them); textures saved as JPEG so the files stay small (on the GPU they take
the same memory as the PNGs). The heads are cut from the base characters (the triangles above the
neck) and bound to the outfits' skeletons.

Kenney: https://kenney.nl · Quaternius: https://quaternius.com
