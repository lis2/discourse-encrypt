# frozen_string_literal: true

describe Jobs::EncryptConsistency do
  let(:topic) { Fabricate(:encrypt_topic) }

  let(:user_without_invite) { Fabricate(:user) }
  let(:user_without_key) { Fabricate(:user) }

  before do
    DiscourseEncrypt::set_key(topic.id, user_without_invite.id, 'topic key')
    TopicAllowedUser.create(topic_id: topic.id, user_id: user_without_key.id)
  end

  it 'ensures invites and topic keys are consistent' do
    expect { subject.execute({}) }
      .to change { TopicAllowedUser.exists?(topic: topic, user: user_without_invite) }.from(false).to(true)
      .and change { TopicAllowedUser.exists?(topic: topic, user: user_without_key) }.from(true).to(false)
  end
end
