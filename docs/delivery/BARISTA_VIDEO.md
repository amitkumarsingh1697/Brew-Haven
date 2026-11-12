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

## How it works

- `branding.baristaVideo` on the business: `{ idle, wave?, keyColor? }`. The menu API passes it to
  the customer app; saving café settings keeps it.
- `VideoBarista` in `apps/customer/src/components/Cafe3D.tsx` draws the clip on a plane behind the
  counter with a chroma-key shader (soft edges, green spill removed), warmed slightly to match the
  lamps. A tap plays the wave clip once.
- Reduced motion shows the first frame, still. If the clip fails to load or play, the drawn barista
  is used. Devices that get the 2D scene are unaffected.
- The scene is lighter with video: 62 draw calls instead of 82.
