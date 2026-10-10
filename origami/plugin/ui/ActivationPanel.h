#pragma once
#include <JuceHeader.h>
#include <BinaryData.h>
#include <utility>
#include <melogic/account/AccountService.h>

namespace mct::origami::ui {
// The initiating editor owns pending plaintext only until login completes or is abandoned.
// No worker callbacks capture this component; the shared service remains the auth authority.
class ActivationPanel final : public juce::Component {
public:
    explicit ActivationPanel(std::shared_ptr<melogic::account::Service> account = melogic::account::Service::shared())
        : account_(std::move(account)) {
        setName("Origami activation surface");setOpaque(true);setInterceptsMouseClicks(true,true);
        setWantsKeyboardFocus(true);setFocusContainerType(FocusContainerType::keyboardFocusContainer);
        for(auto* c:std::array<juce::Component*,5>{&status_,&accountLabel_,&signIn_,&key_,&activate_})addAndMakeVisible(c);
        status_.setName("Activation status");status_.setJustificationType(juce::Justification::centred);status_.setFont(juce::FontOptions(12.f));
        accountLabel_.setJustificationType(juce::Justification::centred);accountLabel_.setFont(juce::FontOptions(12.f));
        signIn_.setName("Activation sign in");secondary_.setName("Activation cancel or logout");activate_.setName("Activate license key");
        key_.setName("Origami license key");key_.setMultiLine(false);key_.setPasswordCharacter(0x2022);key_.setTextToShowWhenEmpty("Enter license key",juce::Colour(0xff777777));
        key_.setColour(juce::TextEditor::backgroundColourId,juce::Colour(0xff121214));key_.setColour(juce::TextEditor::textColourId,juce::Colour(0xffeeeeee));key_.setColour(juce::TextEditor::outlineColourId,juce::Colour(0xff444444));key_.setColour(juce::TextEditor::focusedOutlineColourId,juce::Colour(0xff88343a));
        key_.setInputRestrictions(256);
        key_.onTextChange=[this]{notice_.clear();updateInput(account_->snapshot());};
        key_.onReturnKey=[this]{activate();};
        signIn_.onClick=[this]{
            if(!signIn_.isEnabled())return;
            notice_.clear();const auto s=account_->snapshot();
            if(s.storageError || s.state==melogic::account::State::SignedIn)account_->restoreAccess();else account_->signIn();
            sync(false);
        };
        secondary_.onClick=[this]{
            pendingKey_.clear();clearEntry();
            if(account_->snapshot().state==melogic::account::State::AwaitingBrowser){notice_="Sign-in was cancelled.";account_->cancel();}
            else {notice_.clear();account_->logout();}
            sync(false);
        };
        activate_.onClick=[this]{activate();};
        signIn_.setColour(juce::TextButton::buttonColourId,juce::Colour(0xff281619));
        sync(false);
    }
    ~ActivationPanel() override {pendingKey_.clear();key_.setText({},false);}
    void sync(bool launchBrowser=true) {
        using namespace melogic::account;
        auto s=account_->snapshot();
        if(s.authorization.state==AuthorizationState::Authorized){pendingKey_.clear();clearEntry();notice_.clear();}
        else if(pendingKey_.isNotEmpty()) {
            if(s.state==State::SignedIn) {
                // Consume before submission: repeated UI syncs cannot redeem twice.
                diagnostic("pending_key_continue","redeem_requested");
                const auto key=std::exchange(pendingKey_,{});clearEntry();account_->redeem(key);s=account_->snapshot();
            } else if(s.state!=State::AwaitingBrowser && s.state!=State::Restoring && s.state!=State::Refreshing) {
                pendingKey_.clear();clearEntry();
                notice_=s.state==State::SignedOut?"Sign-in was cancelled.":s.message;
            }
        }
        const bool signedIn=s.state==State::SignedIn;
        juce::String status=notice_;
        if(s.authorization.state==AuthorizationState::Error)status=s.authorization.message;
        else if(s.authorization.state==AuthorizationState::RedeemingKey)status="Activating Origami...";
        else if(isBusy(s))status=s.message;
        else if(s.state==State::Error || s.state==State::OfflineCached)status=s.message;
        status_.setText(status,juce::dontSendNotification);
        accountLabel_.setText(signedIn?"Signed in as "+s.identity.email:juce::String{},juce::dontSendNotification);accountLabel_.setVisible(signedIn);
        signIn_.setButtonText(s.storageError?"RETRY ACCOUNT ACCESS":signedIn?"RECHECK ORIGAMI ACCESS":"SIGN IN TO MELOGIC");signIn_.setEnabled(!isBusy(s));
        const bool secondary=s.state==State::AwaitingBrowser || s.identity.uid.isNotEmpty();
        if(secondary && secondary_.getParentComponent()!=this)addAndMakeVisible(secondary_);
        else if(!secondary)removeChildComponent(&secondary_);
        secondary_.setButtonText(s.state==State::AwaitingBrowser?"CANCEL SIGN-IN":"LOG OUT");secondary_.setEnabled(!isBusy(s) || s.state==State::AwaitingBrowser);
        updateInput(s);resized();
        if(launchBrowser){const auto url=account_->takeBrowserURL();if(url.isNotEmpty() && !juce::URL(url).launchInDefaultBrowser()){pendingKey_.clear();clearEntry();notice_="Unable to open Melogic sign-in. Please try again.";account_->cancel();}}
    }
    void resized() override {
        // Keep the original 500 x 430 centred branding reference, independent of controls/state.
        const auto box=getLocalBounds().withSizeKeepingCentre(juce::jmin(500,getWidth()-40),430);
        body_=box;
        accountLabel_.setBounds(box.withY(box.getY()+145).withHeight(18));
        auto actions=box.withY(box.getY()+174).withHeight(32);
        if(secondary_.getParentComponent()==this){signIn_.setBounds(actions.removeFromLeft(actions.getWidth()-125));actions.removeFromLeft(8);secondary_.setBounds(actions);}
        else signIn_.setBounds(actions);
        key_.setBounds(box.withY(box.getY()+260).withHeight(32));
        activate_.setBounds(box.withY(box.getY()+302).withHeight(32));
        status_.setBounds(box.withY(box.getY()+350).withHeight(68));
    }
    void paint(juce::Graphics& g) override {
        g.fillAll(juce::Colour(0xff0b0b0d));auto b=body_;
        const auto logo=juce::ImageCache::getFromMemory(BinaryData::mct_origami_wordmark_png,BinaryData::mct_origami_wordmark_pngSize);
        g.drawImageWithin(logo,b.getX()+75,b.getY(),b.getWidth()-150,80,juce::RectanglePlacement::centred);
        g.setColour(juce::Colour(0xff999999));g.setFont(juce::FontOptions(12.f));g.drawText("SYNTHESIS, UNFOLDED.",b.withY(b.getY()+85).withHeight(20),juce::Justification::centred);
        g.setColour(juce::Colour(0xffeeeeee));g.setFont(juce::FontOptions(18.f));g.drawText("Activate Origami to continue.",b.withY(b.getY()+116).withHeight(26),juce::Justification::centred);
        g.setColour(juce::Colour(0xff777777));g.setFont(juce::FontOptions(11.f));g.drawText("OR",b.withY(key_.getY()-34).withHeight(20),juce::Justification::centred);
    }
private:
    static bool isBusy(const melogic::account::Snapshot& s) {
        using namespace melogic::account;
        return s.state==State::Restoring || s.state==State::Refreshing || s.state==State::AwaitingBrowser || s.state==State::SigningOut || s.authorization.state==AuthorizationState::RedeemingKey;
    }
    void clearEntry(){key_.setText({},false);}
    void updateInput(const melogic::account::Snapshot& s) {
        key_.setEnabled(!isBusy(s) && pendingKey_.isEmpty());
        activate_.setButtonText(s.authorization.state==melogic::account::AuthorizationState::RedeemingKey?"ACTIVATING...":pendingKey_.isNotEmpty()?"SIGNING IN...":"ACTIVATE");
        activate_.setEnabled(!isBusy(s) && pendingKey_.isEmpty() && key_.getText().trim().isNotEmpty());
    }
    void activate() {
        using namespace melogic::account;
        const auto s=account_->snapshot();const auto key=key_.getText().trim();
        if(isBusy(s) || pendingKey_.isNotEmpty() || key.isEmpty())return;
        notice_.clear();
        if(s.state==State::SignedIn){clearEntry();account_->redeem(key);}
        else {pendingKey_=key;diagnostic("pending_key","present");account_->signIn();}
        sync(false);
    }
    std::shared_ptr<melogic::account::Service> account_;
    juce::String pendingKey_,notice_;
    juce::Rectangle<int> body_;
    juce::Label status_,accountLabel_;
    juce::TextButton signIn_,secondary_,activate_{"ACTIVATE"};
    juce::TextEditor key_;
};
}
