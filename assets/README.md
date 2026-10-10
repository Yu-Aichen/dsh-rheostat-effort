# Drop 24 portrait frames in this directory, named intensity-NN.webp:
#
#   intensity-00.webp  intensity-01.webp  intensity-03.webp  intensity-04.webp
#   intensity-06.webp  intensity-07.webp  intensity-09.webp  intensity-10.webp
#   intensity-12.webp  intensity-13.webp  intensity-14.webp  intensity-15.webp
#   intensity-16.webp  intensity-17.webp  intensity-18.webp  intensity-19.webp
#   intensity-21.webp  intensity-22.webp  intensity-24.webp  intensity-25.webp
#   intensity-27.webp  intensity-28.webp  intensity-29.webp  intensity-30.webp
#
# These are the anchor levels declared in lib/logic.js (ANCHOR_LEVELS); levels
# without a frame are blended from the two neighbours. The host half rescans this
# directory on every launch, so replacing images needs no rebuild.
#
# The frames are deliberately NOT part of this repository: they are third-party
# portrait photographs, and the MIT license covers only the code. Supply imagery
# you are entitled to use.
#
# Square images work best; the backdrop scales them with object-fit: cover and
# anchors the visible window to the right, so the subject should sit around the
# middle of the frame.
