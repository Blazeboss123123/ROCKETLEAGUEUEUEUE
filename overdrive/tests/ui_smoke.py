"""Browser UI smoke tests (headless Chromium via Playwright).
Run the dedicated server first:  node server/server.js --port 8099
Then:  python3 tests/ui_smoke.py [http://localhost:8099/] [path/to/chrome]
"""
import asyncio, sys
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8099/'
CHROME = sys.argv[2] if len(sys.argv) > 2 else None
results = []

def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail and not ok else ''))

async def main():
    async with async_playwright() as p:
        kw = {'args': ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']}
        if CHROME: kw['executable_path'] = CHROME
        b = await p.chromium.launch(**kw)
        pg = await b.new_page(viewport={'width': 1280, 'height': 720})
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        await pg.goto(URL); await pg.wait_for_function('window.__od && window.__od.screenName === "main"')
        ev = pg.evaluate

        # every main-menu button navigates somewhere and back works
        labels = await ev("[...document.querySelectorAll('.navbtn')].map(b => b.firstChild.textContent.trim())")
        expect = {'Play': 'play', 'Training': 'training', 'Garage': 'garage', 'Customise': 'garage', 'Profile': 'profile', 'Statistics': 'stats', 'Settings': 'settings', 'Credits': 'credits', 'Exit': 'exit'}
        for lab in labels:
            await ev(f"[...document.querySelectorAll('.navbtn')].find(b => b.firstChild.textContent.trim() === {lab!r}).click()")
            await pg.wait_for_timeout(150)
            name = await ev('__od.screenName')
            check(f'main menu "{lab}" opens {expect.get(lab)}', name == expect.get(lab), name)
            await ev("__od.go('main')"); await pg.wait_for_timeout(100)

        # settings persist after a restart
        await ev("__od.settings.fov = 108; __od.applySettings('fov'); __od.settings.volMusic = 0.25; __od.applySettings('volMusic')")
        # keybinds can be changed (with conflict swap) and persist
        swapped = await ev("__od.input.bind('kb','jump',0,'KeyJ')")
        conflict = await ev("__od.input.bind('kb','boost',0,'KeyW')")
        check('binding a used key reports the conflict', conflict == 'accel', str(conflict))
        # customisation persists: pick Comet in the garage and confirm
        await ev("__od.go('garage')"); await pg.wait_for_timeout(200)
        key_before = await ev('__od.renderer.showroom.key')
        await ev("[...document.querySelectorAll('.item')].find(b => b.textContent.includes('Comet')).click()")
        await pg.wait_for_timeout(100)
        key_after = await ev('__od.renderer.showroom.key')
        check('garage preview updates on selection', key_before != key_after)
        await ev("[...document.querySelectorAll('button')].find(b => b.textContent === 'Confirm').click()")
        await pg.reload(); await pg.wait_for_function('window.__od && window.__od.screenName === "main"')
        check('settings persist after restart', await ev('__od.settings.fov') == 108 and await ev('__od.settings.volMusic') == 0.25)
        check('keybinds persist after restart', await ev("__od.input.binds.kb.jump[0]") == 'KeyJ' and await ev("__od.input.binds.kb.accel[0]") == 'ShiftLeft')
        check('customisation persists after restart', await ev('__od.profile.loadout.body') == 'comet')
        await ev("__od.input.resetDefaults()")

        # a short offline match: scoreboard, result screen, back to menu without reloading
        await ev("__od.practice({mode:'1v1', difficulty:'rookie', arena:'stadium', duration: 4})")
        await pg.wait_for_function('__od.session && __od.session.world')
        await ev("__od.debugAdvance(4)")
        # force a goal for blue on the authority to know the expected result
        await ev("(() => { const w = __od.localHost.world; w.ball.pos.set(0, 2, w.arena.halfL - 2); w.ball.vel.set(0, 0, 20); })()")
        await ev("__od.debugAdvance(1.5)")
        sb = await ev("__od.session.world.match.score")
        check('scoreboard shows the authoritative score', sb == [1, 0], str(sb))
        await ev("__od.debugAdvance(0.2, {}, {scoreboard: true})")
        board = await ev("!document.querySelector('.hud .overlay').classList.contains('hidden') && document.querySelector('.hud .overlay').textContent")
        check('scoreboard overlay renders', board and 'Blue' in board)
        for _ in range(30):
            await ev("__od.debugAdvance(1)")
            if await ev("!!__od.resultsEl"): break
        res = await ev("__od.resultsEl && __od.resultsEl.el.querySelector('.result-head').textContent")
        check('post-match screen reports the correct result', res and 'VICTORY' in res and '1 – 0' in res, str(res))
        check('profile recorded the match', await ev('__od.profile.stats.matches') >= 1)
        await ev("[...document.querySelectorAll('button')].find(b => b.textContent === 'Main menu').click()")
        await pg.wait_for_timeout(200)
        check('return to main menu without restarting', await ev("__od.screenName") == 'main' and await ev("__od.mode") == 'menu')

        # training drill runs and can be left
        await ev("__od.startTraining('shooting')"); await ev("__od.debugAdvance(2, {throttle: 1})")
        check('training drill runs', await ev("__od.mode") == 'training' and await ev("__od.training.world.tick") > 200)
        await ev("__od.leaveSession()")
        check('no uncaught page errors', not errors, '; '.join(errors[:3]))
        await b.close()

asyncio.run(main())
failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} UI checks passed')
sys.exit(1 if failed else 0)
