// Run against npm start: playwright-cli run-code --filename=tools/browser-paint-check.js
// Real app, brush, textures, renderer and save payload; only tracking and API
// are mocked. No fixture data is written to the project's database.
async page => {
  const checks = [];
  const check = (name, ok) => { if (!ok) throw new Error(name); checks.push(name); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', route => route.fulfill({
    path: 'node_modules/three/build/three.module.js', contentType: 'text/javascript',
  }));
  await page.route('**/js/core/arSession.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    import * as THREE from 'three';
    export function filterFromSearch() { return {}; }
    export function createArSession({container,onFound,onLost}) {
      const renderer = new THREE.WebGLRenderer({alpha:true,preserveDrawingBuffer:true});
      renderer.setSize(innerWidth,innerHeight); renderer.setClearColor(0,0);
      container.append(renderer.domElement);
      const scene = new THREE.Scene(), group = new THREE.Group(); scene.add(group);
      const camera = new THREE.OrthographicCamera(-1,1,innerHeight/innerWidth,-innerHeight/innerWidth,0.1,10);
      camera.position.z=2; camera.updateMatrixWorld();
      let visible=true; const callbacks=[];
      const session={renderer,scene,group,camera,get visible(){return visible;},
        start:async()=>{},dispose:async()=>{},onFrame:cb=>callbacks.push(cb),
        found(){visible=true;group.visible=true;onFound();},lost(){visible=false;group.visible=false;onLost();}};
      window.__ar=session;
      function frame(){for(const cb of callbacks)cb(); renderer.render(scene,camera); requestAnimationFrame(frame);}
      requestAnimationFrame(frame); return session;
    }` }));
  await page.route('**/api/markers/1', route => route.fulfill({ json: {
    status: 'ready', mindUrl: '/test.mind', aspect: 1.5, imageUrl: '/test-marker.svg',
    poses: [{ id: 'human_a', label: 'A', url: '/test-mask.svg' }],
  } }));
  await page.route('**/test-marker.svg', route => route.fulfill({ contentType: 'image/svg+xml', body:
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><path fill="#e02020" d="M0 0h300v900H0z"/><path fill="#2040e0" d="M300 0h300v900H300z"/></svg>' }));
  await page.route('**/test-mask.svg', route => route.fulfill({ contentType: 'image/svg+xml', body:
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><path fill="black" d="M0 0h512v512H0z"/><path fill="white" d="M128 128h256v256H128z"/></svg>' }));
  let saved;
  await page.route('**/api/hides', async route => {
    saved = route.request().postDataJSON();
    await route.fulfill({ json: { id: 99, shareUrl: '/seek.html?hide=99' } });
  });
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('http://localhost:3000/hide.html?marker=1');
  await page.waitForFunction(() => !document.querySelector('#start').disabled);
  const slider = async (id, value) => page.locator('#' + id).evaluate((el, value) => {
    el.value=value; el.dispatchEvent(new Event('input', {bubbles:true}));
  }, String(value));
  await slider('scale',.42);
  // Placement drag establishes an off-centre origin before locking and painting.
  await page.mouse.move(500,400);await page.mouse.down();await page.mouse.move(530,420);await page.mouse.up();
  await slider('rotate',90);
  await page.locator('#lock').click();
  await page.waitForFunction(() => document.querySelector('#paint-preview').width > 0);
  const sync = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const paintURL = () => page.evaluate(() => window.__ar.group.children.find(m => m.renderOrder===10).material.map.image.toDataURL());
  const previewPoint = async (u,v) => { const b=await page.locator('#paint-preview').boundingBox(); return {x:b.x+u*b.width,y:b.y+(1-v)*b.height}; };
  const arPoint = (u,v) => page.evaluate(({u,v}) => {
    const ar=window.__ar, mesh=ar.group.children.find(m=>m.renderOrder===10);
    mesh.updateWorldMatrix(true,false);
    // Transform using THREE's actual matrix and camera projection via a clone.
    const point=mesh.position.clone().set(u-.5,v-.5,0).applyMatrix4(mesh.matrixWorld).project(ar.camera);
    const r=ar.renderer.domElement.getBoundingClientRect();
    return {x:r.left+(point.x+1)*r.width/2,y:r.top+(1-point.y)*r.height/2};
  },{u,v});
  const drag = async (a,b) => {await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();await sync();};
  const initial=await paintURL();
  await drag(await previewPoint(.4,.4),await previewPoint(.6,.4));
  const previewPaint=await paintURL(); check('Preview paints shared canvas',initial!==previewPaint);
  await page.locator('#hud-hide').click();
  check('HUD hides and restore remains accessible',await page.locator('#hud-restore').isVisible() && !await page.locator('#hud').isVisible());
  await drag(await arPoint(.4,.6),await arPoint(.6,.6));
  const bothPaint=await paintURL();check('Rotated AR brush updates same canvas',bothPaint!==previewPaint);
  await page.locator('#hud-restore').click();
  await page.locator('#preview-expand').click();await sync();
  check('Expanded preview preserves paint',await paintURL()===bothPaint);
  check('Expanded mode has explicit exit',await page.locator('#preview-expand').getAttribute('aria-expanded')==='true');
  await slider('model-opacity',0);await sync();
  const backdropPixels=await page.locator('#paint-preview').evaluate(c=>{
    const ctx=c.getContext('2d'); return [.2,.8].map(v=>Array.from(ctx.getImageData(c.width*.5,c.height*(1-v),1,1).data));
  });
  check('Moved, scaled, 90 degree background shows blue below and red above',backdropPixels[0][2]>200 && backdropPixels[1][0]>200);
  await page.locator('#tool').click();
  const pick=await previewPoint(.5,.8);await page.mouse.click(pick.x,pick.y);await sync();
  check('Preview eyedropper picks background and returns to brush',await page.locator('#tool').getAttribute('aria-pressed')==='false' && await page.locator('#current-color').evaluate(el=>el.style.backgroundColor)==='rgb(224, 32, 32)');
  check('Opacity and eyedropper preserve saved paint',await paintURL()===bothPaint);
  await slider('model-opacity',35);await sync();
  check('AR opacity follows existing control',await page.evaluate(()=>window.__ar.group.children.find(m=>m.renderOrder===10).material.opacity)===.35);
  await page.locator('#preview-expand').click();await sync();
  check('Shrink preserves paint',await paintURL()===bothPaint);
  // AR eyedropper retains marker-plane tap semantics, even with a rotated model.
  await page.locator('#tool').click();
  await page.locator('#hud-hide').click();
  const arPick=await arPoint(.5,.9);await page.mouse.click(arPick.x,arPick.y);
  await page.locator('#hud-restore').click();
  check('AR eyedropper picks source marker and returns to brush',await page.locator('#tool').getAttribute('aria-pressed')==='false' && await page.locator('#current-color').evaluate(el=>el.style.backgroundColor)==='rgb(224, 32, 32)');
  check('AR eyedropper never paints',await paintURL()===bothPaint);
  // Loss mid-AR-stroke, followed by reacquisition with the finger still down.
  await page.locator('#hud-hide').click();
  const a=await arPoint(.35,.5), b=await arPoint(.65,.5);
  await page.mouse.move(a.x,a.y);await page.mouse.down();
  await page.evaluate(()=>window.__ar.lost());await sync();
  check('Hidden HUD still reports lost tracking',await page.locator('#hud-restore').innerText().then(t=>t.includes('Tracking lost')));
  const atLoss=await paintURL();
  await page.evaluate(()=>window.__ar.found());
  await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();await sync();
  check('Tracking regain never resumes old stroke',await paintURL()===atLoss);
  await page.evaluate(()=>window.__ar.lost());
  await page.locator('#hud-restore').click();
  await drag(await previewPoint(.4,.7),await previewPoint(.6,.7));
  const offlinePaint=await paintURL();check('Preview paints without tracking',offlinePaint!==atLoss);
  // Compare actual WebGL framebuffer colour against preview for a brush stroke.
  await page.evaluate(()=>window.__ar.found());
  await slider('model-opacity',100);
  await page.locator('#hud-hide').click();await sync();
  const arPixelPoint=await arPoint(.5,.4);
  const arPixel=await page.evaluate(({x,y})=>{
    const renderer=window.__ar.renderer, gl=renderer.getContext(), r=renderer.domElement.getBoundingClientRect();
    renderer.render(window.__ar.scene,window.__ar.camera);
    const pixel=new Uint8Array(4);
    gl.readPixels(Math.floor((x-r.left)/r.width*gl.drawingBufferWidth),Math.floor((r.bottom-y)/r.height*gl.drawingBufferHeight),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    return Array.from(pixel);
  },arPixelPoint);
  await page.locator('#hud-restore').click();await sync();
  const previewPixel=await page.locator('#paint-preview').evaluate(c=>Array.from(c.getContext('2d').getImageData(c.width*.5,c.height*.6,1,1).data));
  check('AR framebuffer and preview show same painted colour',arPixel.every((v,i)=>Math.abs(v-previewPixel[i])<=2));
  await slider('model-opacity',35);
  await page.locator('#review').click();await page.locator('#save').click();
  await page.waitForFunction(()=>document.querySelector('#share input'));
  check('Save exports exact shared canvas, independent of opacity',saved.paintDataUrl===offlinePaint && saved.transform.rot===Math.PI/2);
  const reloaded=await page.evaluate(async saved=>{
    const {createSilhouette}=await import('/js/core/silhouette.js');
    const seek=await createSilhouette({maskUrl:'/test-mask.svg'});
    await seek.loadPaint(saved.paintDataUrl);seek.setTransform(saved.transform);
    const matches=seek.getPaintDataUrl()===saved.paintDataUrl && seek.mesh.rotation.z===saved.transform.rot;
    seek.dispose();return matches;
  },saved);
  check('Seek loader reconstructs the same saved paint and rotation',reloaded);
  await page.locator('#edit').click();
  check('Edit restores full silhouette visibility',await page.evaluate(()=>window.__ar.group.children.find(m=>m.renderOrder===10).visible));
  await page.setViewportSize({width:390,height:700});await sync();
  await page.locator('#preview-expand').click();await sync();
  check('Mobile expanded preview fits viewport',await page.locator('#paint-preview').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;}));
  await page.screenshot({path:'.playwright-cli/paint-mobile.png'});
  await page.keyboard.press('Escape');
  check('Escape exits expanded preview',await page.locator('#preview-expand').getAttribute('aria-expanded')==='false');
  check('No browser runtime errors',errors.length===0);
  // Failed image remains a usable painter with a persistent explanation.
  await page.route('**/test-marker.svg',route=>route.fulfill({status:404,body:'missing'}));
  await page.reload();await page.waitForFunction(()=>!document.querySelector('#start').disabled);
  await page.locator('#lock').click();await sync();
  check('Marker load failure explains fallback',await page.locator('#palette-note').innerText().then(t=>t.includes('fallback')));
  const fallback=await paintURL();await drag(await previewPoint(.4,.5),await previewPoint(.6,.5));
  check('Marker failure keeps painting usable',await paintURL()!==fallback);
  return {checks,errors};
}
