import RAPIER from "@dimforge/rapier3d-compat";

/** Renderer-independent WASM simulation. The caller owns world.free(). */
export async function createBoxWorld() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  try {
    world.createCollider(RAPIER.ColliderDesc.cuboid(12, 0.25, 12).setTranslation(0, -0.25, 0));
    const boxes = Array.from({ length: 36 }, (_, i) => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(
        (i % 3 - 1) * 1.15, 1 + Math.floor(i / 9) * 1.15, (Math.floor(i / 3) % 3 - 1) * 1.15
      ));
      world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setRestitution(0.25), body);
      return { body, previousPosition: body.translation(), previousRotation: body.rotation() };
    });
    return {
      world,
      boxes,
      step(dt: number) {
        for(const box of boxes) {
          box.previousPosition = box.body.translation();
          box.previousRotation = box.body.rotation();
        }
        world.timestep = dt;
        world.step();
      },
      scatter() {
        for(const { body } of boxes) {
          const p = body.translation();
          body.applyImpulse({ x: p.x * 2, y: 5, z: p.z * 2 }, true);
        }
      }
    };
  } catch (error) {
    world.free();
    throw error;
  }
}
