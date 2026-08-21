(function(){
  var buttons = Array.prototype.slice.call(document.querySelectorAll(".segbtn"));
  var pill = document.getElementById("pill");
  var nav = document.querySelector(".segnav");
  var sections = buttons.map(function(btn){
    return document.getElementById(btn.dataset.target);
  });

  var colorVar = {
    coral:  "var(--coral-soft)",
    indigo: "var(--indigo-soft)",
    teal:   "var(--teal-soft)"
  };

  function movePill(index){
    var btn = buttons[index];
    if(!btn || !pill) return;
    pill.style.left = btn.offsetLeft + "px";
    pill.style.width = btn.offsetWidth + "px";
    pill.style.background = colorVar[btn.dataset.color] || colorVar.coral;
  }

  function setActive(index){
    buttons.forEach(function(btn, i){
      btn.classList.toggle("active", i === index);
    });
    movePill(index);
  }

  buttons.forEach(function(btn, i){
    btn.addEventListener("click", function(){
      var target = sections[i];
      if(target){
        target.scrollIntoView({behavior:"smooth", block:"start"});
      }
      setActive(i);
    });
  });

  if("IntersectionObserver" in window){
    var observer = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting){
          var idx = sections.indexOf(entry.target);
          if(idx !== -1) setActive(idx);
        }
      });
    }, { rootMargin: "-40% 0px -50% 0px", threshold: 0 });

    sections.forEach(function(sec){
      if(sec) observer.observe(sec);
    });
  }

  window.addEventListener("load", function(){ setActive(0); });
  window.addEventListener("resize", function(){
    var activeIdx = buttons.findIndex(function(b){ return b.classList.contains("active"); });
    movePill(activeIdx === -1 ? 0 : activeIdx);
  });

  // ---- Notepad page-flip for diary entries ----
  var pages = Array.prototype.slice.call(document.querySelectorAll(".diary-entry"));
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if(pages.length && !reduceMotion){
    var ticking = false;

    function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

    function updatePages(){
      var vh = window.innerHeight;
      var flipStart = vh * 0.32;   // page begins flipping once its top reaches this line
      var flipRange = vh * 0.62;   // distance over which the flip completes

      pages.forEach(function(page, i){
        var rect = page.getBoundingClientRect();
        var progress = clamp((flipStart - rect.top) / flipRange, 0, 1);
        var angle = progress * -115;
        var scale = 1 - progress * 0.05;
        var opacity = 1 - progress * 0.92;

        page.style.transform = "rotateX(" + angle + "deg) scale(" + scale + ")";
        page.style.opacity = opacity;
        page.style.zIndex = pages.length - i;
        page.style.pointerEvents = progress > 0.6 ? "none" : "auto";
      });

      ticking = false;
    }

    function onScroll(){
      if(!ticking){
        window.requestAnimationFrame(updatePages);
        ticking = true;
      }
    }

    window.addEventListener("scroll", onScroll, { passive:true });
    window.addEventListener("resize", onScroll);
    updatePages();
  }
})();
