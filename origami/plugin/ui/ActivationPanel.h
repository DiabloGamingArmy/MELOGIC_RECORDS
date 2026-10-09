#pragma once
#include <JuceHeader.h>
#include <BinaryData.h>
#include <melogic/account/AccountService.h>

namespace mct::origami::ui {
// Full editor surface; the editor disables one parent containing the synth UI.
class ActivationPanel final : public juce::Component {
public:
    ActivationPanel() : account_(melogic::account::Service::shared()) {
        setName("Origami activation surface");setOpaque(true);setInterceptsMouseClicks(true,true);
        setWantsKeyboardFocus(true);setFocusContainerType(FocusContainerType::keyboardFocusContainer);
        for(auto* c:std::array<juce::Component*,7>{&status_,&accountLabel_,&signIn_,&secondary_,&key_,&activate_,&profile_})addAndMakeVisible(c);
        status_.setName("Activation status");status_.setJustificationType(juce::Justification::centred);status_.setFont(juce::FontOptions(14.f));
        accountLabel_.setJustificationType(juce::Justification::centred);accountLabel_.setFont(juce::FontOptions(12.f));
        signIn_.setName("Activation sign in");secondary_.setName("Activation cancel or logout");activate_.setName("Activate license key");
        key_.setName("Origami license key");key_.setMultiLine(false);key_.setPasswordCharacter(0x2022);key_.setTextToShowWhenEmpty("Paste or enter your license key",juce::Colour(0xff777777));
        key_.setColour(juce::TextEditor::backgroundColourId,juce::Colour(0xff121214));key_.setColour(juce::TextEditor::textColourId,juce::Colour(0xffeeeeee));key_.setColour(juce::TextEditor::outlineColourId,juce::Colour(0xff444444));key_.setColour(juce::TextEditor::focusedOutlineColourId,juce::Colour(0xff88343a));
        key_.setInputRestrictions(256);key_.onTextChange=[this]{sync(false);};key_.onReturnKey=[this]{if(activate_.isEnabled())activate_.triggerClick();};
        signIn_.onClick=[this]{const auto s=account_->snapshot();if(s.storageError)account_->restoreAccess();else if(s.identity.uid.isNotEmpty() && s.state==melogic::account::State::SignedIn)account_->restoreAccess();else account_->signIn();};
        secondary_.onClick=[this]{if(account_->snapshot().state==melogic::account::State::AwaitingBrowser)account_->cancel();else account_->logout();key_.clear();};
        activate_.onClick=[this]{const auto value=key_.getText().trim();key_.clear();account_->redeem(value);sync(false);};
        signIn_.setColour(juce::TextButton::buttonColourId,juce::Colour(0xff281619));
        sync(false);
    }
    void sync(bool launchBrowser=true) {
        using namespace melogic::account;
        const auto s=account_->snapshot();const bool signedIn=s.state==State::SignedIn;
        const bool busy=s.state==State::Restoring || s.state==State::Refreshing || s.state==State::AwaitingBrowser || s.state==State::SigningOut || s.authorization.state==AuthorizationState::RedeemingKey;
        status_.setText(s.authorization.state==AuthorizationState::Error || signedIn?s.authorization.message:s.message,juce::dontSendNotification);
        accountLabel_.setText(signedIn?(s.identity.displayName.isEmpty()?s.identity.email:s.identity.displayName)+" / "+s.identity.email:"A Melogic account is required to redeem a license key.",juce::dontSendNotification);
        signIn_.setButtonText(s.storageError?"RETRY ACCOUNT ACCESS":signedIn?"RECHECK ORIGAMI ACCESS":"SIGN IN TO MELOGIC");signIn_.setEnabled(!busy);
        secondary_.setButtonText(s.state==State::AwaitingBrowser?"CANCEL SIGN-IN":"LOG OUT");secondary_.setEnabled(s.identity.uid.isNotEmpty() || s.state==State::AwaitingBrowser || s.storageError);
        key_.setEnabled(!busy);activate_.setEnabled(signedIn && !busy && key_.getText().trim().isNotEmpty());
        if(launchBrowser){const auto url=account_->takeBrowserURL();if(url.isNotEmpty() && !juce::URL(url).launchInDefaultBrowser())account_->cancel();}
    }
    void resized() override {
        auto box=getLocalBounds().withSizeKeepingCentre(juce::jmin(500,getWidth()-40),430);
        body_=box;profile_.setBounds(box.withY(box.getBottom()+20).withHeight(22));box.removeFromTop(145);status_.setBounds(box.removeFromTop(48));accountLabel_.setBounds(box.removeFromTop(42));box.removeFromTop(12);
        auto actions=box.removeFromTop(32);signIn_.setBounds(actions.removeFromLeft(actions.getWidth()-125));actions.removeFromLeft(8);secondary_.setBounds(actions);
        box.removeFromTop(56);key_.setBounds(box.removeFromTop(32));box.removeFromTop(10);activate_.setBounds(box.removeFromTop(32));
    }
    void paint(juce::Graphics& g) override {
        g.fillAll(juce::Colour(0xff0b0b0d));auto b=body_;
        const auto logo=juce::ImageCache::getFromMemory(BinaryData::mct_origami_wordmark_png,BinaryData::mct_origami_wordmark_pngSize);
        g.drawImageWithin(logo,b.getX()+75,b.getY(),b.getWidth()-150,80,juce::RectanglePlacement::centred);
        g.setColour(juce::Colour(0xff999999));g.setFont(juce::FontOptions(12.f));g.drawText("SYNTHESIS, UNFOLDED.",b.withY(b.getY()+85).withHeight(20),juce::Justification::centred);
        g.setColour(juce::Colour(0xffeeeeee));g.setFont(juce::FontOptions(18.f));g.drawText("Activate Origami to continue.",b.withY(b.getY()+116).withHeight(26),juce::Justification::centred);
        g.setColour(juce::Colour(0xff777777));g.setFont(juce::FontOptions(11.f));g.drawText("OR / ENTER LICENSE KEY",b.withY(key_.getY()-29).withHeight(20),juce::Justification::centred);
        g.setColour(juce::Colour(0xff333333));g.drawHorizontalLine(b.getBottom()+10,float(b.getX()),float(b.getRight()));
    }
private:
    std::shared_ptr<melogic::account::Service> account_;
    juce::Rectangle<int> body_;
    juce::Label status_,accountLabel_;
    juce::TextButton signIn_,secondary_,activate_{"ACTIVATE"};
    juce::TextEditor key_;
    juce::HyperlinkButton profile_{"OPEN MELOGIC ACCOUNT",juce::URL("https://melogicrecords.studio/profile")};
};
}
