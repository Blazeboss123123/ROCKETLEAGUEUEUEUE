// Merge static child meshes that share a material into a single draw call.
import * as THREE from 'three';

// Children with userData.dynamic (and their descendants) are left untouched.
export function mergeByMaterial(group, { castShadow = false, receiveShadow = false } = {}) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const remove = [];
  const visit = (o) => {
    for (const c of [...o.children]) {
      if (c.userData.dynamic || c.isSprite || c.isPoints || c.isLight || c.isInstancedMesh) continue;
      if (c.isMesh && !Array.isArray(c.material)) {
        const m = new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld);
        let g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
        g.applyMatrix4(m);
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        if (!buckets.has(c.material)) buckets.set(c.material, []);
        buckets.get(c.material).push(g);
        remove.push(c);
      }
      visit(c);
    }
  };
  visit(group);
  if (remove.length < 2) return group;
  for (const c of remove) {
    // keep any dynamic descendants by re-parenting them to the group
    for (const ch of [...c.children]) { group.attach(ch); }
    c.parent.remove(c);
  }
  for (const [mat, geos] of buckets) {
    let n = 0; for (const g of geos) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      uv.set(g.attributes.uv.array.subarray(0, g.attributes.position.count * 2), o * 2);
      o += g.attributes.position.count;
      g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow;
    group.add(mesh);
  }
  return group;
}
