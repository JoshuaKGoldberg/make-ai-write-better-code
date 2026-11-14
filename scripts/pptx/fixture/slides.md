---
theme: none
title: Fixture
colorSchema: light
aspectRatio: 4/3
canvasWidth: 800
transition: fade
layout: cover
background: /photo.png
---

# Fixture Cover

A dimmed background image

---

# Lists

<ol start="3">
  <li>Third</li>
  <li>Fourth</li>
</ol>

<ul class="arrows">
  <li>Arrow one</li>
  <li>Arrow two</li>
</ul>

<ul style="list-style: square">
  <li>Square</li>
</ul>

<ol style="list-style-type: lower-alpha">
  <li v-click>Alpha</li>
  <li v-click>Beta</li>
</ol>

---

# Colors and Units

<span class="chip">hsl chip</span>

<div class="ok"></div>
<div class="named"></div>
<div class="mix"></div>
<p class="layered">Layered: lime</p>
<p class="layer-loses">Unlayered: teal</p>

---
transition: slide-left
---

# Pseudo Content

<p class="tag">Starred</p>

<div class="box">Boxed by ::after</div>

---
layout: image-right
image: /photo.png
transition: none
---

# Images

<img class="fit" src="/photo.png" alt="Cropped photo" />
<img src="/shape.svg" alt="SVG shape" width="120" height="80" />

![Imported](./assets/local.png)

---

# After None

The slide before this one plays no transition into it.
