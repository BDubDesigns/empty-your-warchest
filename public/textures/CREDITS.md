# Texture credits

Textures for models and ground built in code. All CC0 (public domain): https://creativecommons.org/publicdomain/zero/1.0/

| Files                                                   | Source                                                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| wood/bark.jpg, wood/bark_normal.jpg                     | Poly Haven, Bark Brown 02 by Rob Tuytel (colour and OpenGL normal maps), 1k resized to 512 px |
| ground/forest_grass.jpg, ground/forest_grass_normal.jpg | Poly Haven, Forest Ground 01 by Rob Tuytel (colour 1k; normal 1k resized to 512 px)           |
| ground/trodden_dirt.jpg, ground/trodden_dirt_normal.jpg | Poly Haven, Brown Mud Leaves 01 by Rob Tuytel (colour 1k; normal 1k resized to 512 px)        |
| ground/meadow_grass.jpg, ground/meadow_grass_normal.jpg | ambientCG, Grass 004 (colour 1k; OpenGL normal 1k resized to 512 px)                          |

Poly Haven: https://polyhaven.com/a/bark_brown_02, https://polyhaven.com/a/forrest_ground_01,
https://polyhaven.com/a/brown_mud_leaves_01. ambientCG: https://ambientcg.com/view?id=Grass004. Ground kinds are picked by name in `src/app/ground.ts`.

The end grain and split wood are drawn in code (`src/app/woodGrain.ts`), shared by every scene with wood.
