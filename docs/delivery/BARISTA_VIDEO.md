# Filmed barista for the welcome scene

Decided 12 Nov 2026: the 3D welcome scene shows the café's own barista, filmed, instead of the
drawn one. The clip is placed behind the 3D counter with the green screen removed, so the room,
lamps, sign and menu board stay as they are. If a clip can't play, the drawn barista comes back on
its own.

## Filming (about 20 minutes, a phone is enough)

**What you need:** a phone, a tripod or a stack of books, a green cloth or sheet behind the
barista (a matt green bedsheet or a ₹1,500 green-screen cloth both work), and two lamps or a
bright window to the side.

**Consent first.** The barista is shown to every customer who opens the café's link. Get their
written OK (a signed note or an email is fine) and keep it. If they leave the café, we switch back
to the drawn barista or a new clip the same day.

**Set-up**

1. Hang the green cloth flat, with no creases, about 1 m behind the barista.
2. Light the cloth evenly and the barista from the front-left and front-right. Avoid shadows on the cloth.
3. The barista wears the café apron. **Nothing green**, nothing shiny, and no thin stripes.
4. Phone **upright (portrait)**, at chest height, about 1.5 to 2 m away. Frame from **just above
   the head to the waist**: the counter in the scene hides everything below the waist.
5. Lock focus and exposure (tap and hold on the barista's face), and turn off HDR and beauty filters.
6. Film in 1080p at 30 fps. Sound doesn't matter; the clip is silent.

**Three takes**

| Clip | What the barista does | Length |
|---|---|---|
| Idle | Stands relaxed behind the "counter", looks at the camera, smiles, breathes, a small nod. No big movements. | 10 s (we use the best 3 to 4 s) |
| Wave | From the idle pose: smiles, waves at the camera with the right hand, back to idle. | 4 s |
| Welcome (optional) | Says "Welcome!" with a warm smile and a small hand gesture. | 4 s |

Do each take three times, and keep hands **inside the frame** the whole time. Send the original
files (not WhatsApp-compressed: share via Google Drive or AirDrop).

## Processing (us)

```sh
# idle: the best 3 seconds, played forwards then backwards so it loops without a jump
tools/barista-clip.sh idle-take2.mov apps/customer/public/baristas/400-coffee/idle.mp4 2.5 3 --loop
# wave: plays once when the visitor taps the scene
tools/barista-clip.sh wave-take1.mov apps/customer/public/baristas/400-coffee/wave.mp4 0.5 3.5
# switch the café to it (and --off to switch back)
pnpm --filter @brew-haven/api barista-video 400-coffee /baristas/400-coffee/idle.mp4 /baristas/400-coffee/wave.mp4
```

Each clip comes out at 540×960, 24 fps, silent, about 0.5 to 1.5 MB. If the cloth isn't standard
chroma green, pass its colour with `--key=#3fae4a` (pick it from a frame).

## AI clips (what the 400 Coffee demo uses now)

Until the café films its own barista, the demo uses AI clips of "Aarav", made for free on Hugging
Face Spaces on 13 Nov 2026 (Amit approved them the same day). Aarav is not a real person, so no
consent is needed; swap in the filmed clips when they exist.

1. Still: FLUX.1-schnell (`black-forest-labs/FLUX.1-schnell`, `/infer`, 576×1024, seed 21), a
   young barista in a white T-shirt and dark brown apron against a green screen.
2. Motion: Wan 2.2 image-to-video (`zerogpu-aoti/wan2-2-fp8da-aoti-faster`, `/generate_video`,
   4 s, 6 steps, seed 11), once with an idle prompt and once with a wave prompt.
3. Clean-up: `tools/barista-ai-clip.py idle.mp4 apps/customer/public/baristas/400-coffee/idle.mp4 --loop`
   and the same without `--loop` for the wave. The generated backdrop is uneven green, so the tool
   rebuilds it as flat #00b140 (a plain chroma key also removed the white shirt and black hair).

Both Spaces run on free ZeroGPU time with a free Hugging Face token. Call them with plain HTTP
(`POST /gradio_api/call/<fn>`, then read the event stream) and an `Authorization: Bearer` token;
the `gradio_client` library was refused ZeroGPU time from a cloud server even with the token.

The demo seed sets the clips for 400 Coffee. For a database that already exists (the hosted demo),
run the `barista-video` command above once against it.

## How it works

- `branding.baristaVideo` on the business: `{ idle, wave?, keyColor? }`. The menu API passes it to
  the customer app; saving café settings keeps it.
- `VideoBarista` in `apps/customer/src/components/Cafe3D.tsx` draws the clip on a plane behind the
  counter with a chroma-key shader (soft edges, green spill removed), warmed slightly to match the
  lamps. A tap blends in the wave clip, which plays once. Both clips stay bound to the shader, and the
  wave is switched on through the material's own uniforms (react-three-fiber copies the `uniforms`
  object, so changing the original does nothing).
- Reduced motion shows the first frame, still. If the clip fails to load or play, the drawn barista
  is used. Devices that get the 2D scene are unaffected.
- The scene is lighter with video: 62 draw calls instead of 82.
