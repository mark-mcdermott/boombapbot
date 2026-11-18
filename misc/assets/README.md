# The owner's original pictures

This folder is for the owner's unedited pictures. Everything in it except
this file is ignored by git, and nothing in it ever reaches a build.

РИТМ-12's panel art is cut from the pictures in `misc/assets/ritm12/`: one
picture of the whole panel for each position of a stepped control. Run
`python3 packages/machine-ritm12/art/cut-art.py` after changing them; what it
writes into the machine's `art/` folder is what is committed and shipped.
[`packages/machine-ritm12/art/README.md`](../../packages/machine-ritm12/art/README.md)
says what each cut file is and where it comes from.
