(function(){
  var presets = Array.prototype.slice.call(document.querySelectorAll(".preset"));
  var needle = document.getElementById("needle");
  var strip = document.querySelector(".tuner-strip");
  var sections = presets.map(function(btn){
    return document.getElementById(btn.dataset.target);
  });

  function positionNeedle(index){
    if(!strip) return;
    var stripWidth = strip.offsetWidth;
    // Spread presets roughly evenly across the strip, matching real radio dial feel
    var positions = [8, 50, 92]; // percentages
    var pct = positions[index] !== undefined ? positions[index] : 8;
    needle.style.left = pct + "%";
  }

  function setActive(index){
    presets.forEach(function(btn, i){
      btn.classList.toggle("active", i === index);
    });
    positionNeedle(index);
  }

  presets.forEach(function(btn, i){
    btn.addEventListener("click", function(){
      var target = sections[i];
      if(target){
        target.scrollIntoView({behavior:"smooth", block:"start"});
      }
      setActive(i);
    });
  });

  // Scroll-spy: move the needle as the user scrolls past each station
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

  // Initialize needle position on load
  window.addEventListener("load", function(){ positionNeedle(-1); needle.style.left = "8%"; });
})();
