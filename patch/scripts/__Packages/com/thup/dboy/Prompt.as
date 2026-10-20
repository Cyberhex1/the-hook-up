class com.thup.dboy.Prompt extends com.thup.util.EventBroadcaster
{
   // Restoration fix: the original never stored isBig, so closing an info-only
   // ("big") prompt such as "You can not save now." always unfroze the game, even
   // in the middle of a conversation or scene. Big prompts never freeze the game,
   // so now they leave the freeze state alone. Yes/No prompts behave as before.
   var _mc;
   var _previousThinkFreeze;
   var obj;
   var isBig;
   var _libname = "prompt";
   function Prompt(aTxt, isBig)
   {
      super();
      this.isBig = isBig == true;
      var _loc4_ = _root.popup_holder.getNextHighestDepth();
      if(isBig)
      {
         this._libname = "prompt_big";
      }
      _root.popup_holder.attachMovie(this._libname,"prompt" + _loc4_,_loc4_);
      this._mc = _root.popup_holder["prompt" + _loc4_];
      if(isBig)
      {
         this._mc.txt.htmlText = aTxt;
      }
      else
      {
         this._previousThinkFreeze = com.thup.dboy.ThinkManager.freeze;
         com.thup.dboy.ThinkManager.freeze = true;
         this._mc.txt.text = aTxt;
      }
      var me = this;
      var _loc5_ = this._mc.yes;
      _loc5_.obj = this;
      _loc5_.onRelease = function()
      {
         if(!me.isBig)
         {
            com.thup.dboy.ThinkManager.freeze = this._previousThinkFreeze;
         }
         com.thup.dboy.SoundManager.genericClick();
         this.obj.broadcastEvent("onYes",null);
         me.destroy();
      };
      var _loc6_ = this._mc.no;
      _loc6_.obj = this;
      _loc6_.onRelease = function()
      {
         if(!me.isBig)
         {
            com.thup.dboy.ThinkManager.freeze = false;
         }
         com.thup.dboy.SoundManager.genericClick();
         this.obj.broadcastEvent("onNo",null);
         me.destroy();
      };
      this._mc._x = 385;
      this._mc._y = 280;
   }
   function destroy()
   {
      this._mc.removeMovieClip();
   }
}
